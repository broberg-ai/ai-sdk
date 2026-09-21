# F057 — To tavse kontraktbrud, begge i den grønne retning

**Meldt af:** pitch (ref 28546) → components → ai-sdk, 21. september 2026.
components havde IKKE efterprøvet dem; **vi har, førstehånds, mod `dist/` fra v0.47.1.**
Begge er bekræftet. Målingerne står nedenfor.

Fælles mønster, og det er grunden til at de deler ét F-nummer: **begge svarer
"det gik godt" på noget der ikke gik godt.** En sink der intet skriver og en
gate der afviser en model vi har en officiel pris på ligner begge et
velfungerende system fra kaldestedet. De fejler ikke i den røde retning hvor
nogen opdager dem; de fejler grønt.

## Reuse (F217 — obligatorisk)

Discovery-tjek kørt 21/9 2026 mod `discovery.broberg.ai/api/search`:

| kapabilitet | forespørgsel | resultat |
|---|---|---|
| omkostnings-sink / sqlite | `cost sink sqlite` | kun `@broberg/ai-sdk` selv (v0.47.1, shipped) |
| model-registry / availability | `model registry availability` | kun `@broberg/ai-sdk` selv |

**Beslutning: BYG (ret i eget repo).** Der er intet at genbruge — vi ER den
pakke Discovery peger på for begge kapabiliteter. Ingen rå provider-integration
introduceres; begge rettelser ligger inden for facaden.

---

## F057.1 — `sqliteSink` virker ikke på Node, og tavsheden er selve fejlen

### Målt (ikke antaget)

Node v25.6.1, `dist/index.js` fra v0.47.1:

```
import("bun:sqlite")
  → ERR_UNSUPPORTED_ESM_URL_SCHEME
    "Only URLs with a scheme in: file, data, and node are supported by the
     default ESM loader. Received protocol 'bun:'"

sqliteSink({dbPath}).record(usage)
  → kaster samme fejl. Første kald, hver gang.
```

`src/cost/sinks/sqlite.ts` importerer `bun:sqlite` **lazily** med vilje — en
statisk import ville sprænge hele pakke-entryet for enhver Node-forbruger
(kommentaren øverst i filen siger det selv). Den lazy import løste ét problem og
flyttede et andet: fejlen er nu udskudt fra *import* til *første record()*.

### Hvorfor det er farligt og ikke bare ærgerligt

`src/client.ts:272-279`:

```ts
async function report(usage: Usage): Promise<void> {
  if (!costSink) return;
  try {
    await costSink.record(usage);
  } catch {
    // A broken sink must never crash a real AI call (F3.3 invariant).
  }
}
```

**F3.3-invarianten er rigtig** — en sink der har en dårlig dag må ikke vælte et
rigtigt AI-kald. Men den skelner ikke mellem to vidt forskellige ting:

| | hvad det er | rigtig reaktion |
|---|---|---|
| netværk nede, disk fuld, upmetrics 503 | **forbigående** | sluge, prøv igen næste kald |
| `bun:sqlite` findes ikke i denne runtime | **permanent opsætningsfejl** | sig det HØJT, én gang, ved opsætning |

I dag behandles begge som den første. Konsekvensen for en Node-forbruger:
`sqliteSink()` returnerer glad et objekt, hvert `record()` fejler, hver fejl
sluges, og **omkostningsdatasættet er tomt uden at noget sagde fra.** Et tomt
omkostnings-datasæt og et velfungerende ser ens ud i en rapport — det er
components' egen formulering og den er præcis.

### Samme rod, MODSAT retning — og det skal siges højt

`src/cost/budget-store.ts` har nøjagtig samme lazy `bun:sqlite`-import.
Men `BudgetGuard` (`src/cost/budget.ts`) har **ingen** catch, og `preflight()`
i client.ts venter på den uden catch — så `sqliteBudgetStore` på Node får
`ai.chat()` til at **kaste**. Det er fail-closed: højlydt, opdages med det
samme, ingen skade. Kun sink-halvdelen fejler grønt.

Det er værd at skrive ned, fordi en rettelse der "gør bun:sqlite Node-sikker
overalt" kunne komme til at dæmpe budget-halvdelen ned til sink-halvdelens
adfærd. Det ville gøre det værre.

### AC

1. `sqliteSink({dbPath})` kaldt i en runtime uden `bun:sqlite` **kaster ved
   opsætning**, ikke ved første `record()` — med en besked der navngiver
   runtime-kravet (Bun) og alternativet (`upmetricsSink`).
2. En automatiseret test kører **under Node** og fejler hvis (1) holder op med
   at gælde. En test der kun kører under Bun beviser ikke noget her.
3. `sqliteBudgetStore` fejler fortsat **højlydt** på Node — en test låser den
   retning fast, så den ikke ved et uheld bliver dæmpet med.
4. F3.3-invarianten står ved magt: en sink der fejler *undervejs* (netværk,
   disk) vælter stadig ikke et AI-kald. Bevis: en test hvor `record()` kaster
   på kald nr. 2 og `ai.chat()` stadig lykkes.
5. Regressionsprøven for selve fejlen: skriv en usage til en Bun-sqliteSink,
   **læs rækken tilbage med en rå query** og sammenlign med `===`. Ikke
   "returnerede 200", ikke `toContain`.
6. CLAUDE.md / README siger eksplicit at `sqliteSink` er Bun-only.

---

## F057.2 — DeepSeek har en officiel pris og ingen registry-række

### Målt

```
resolveModel("deepseek-chat",     { requireKnown: true })
  → { ok:false, status:"unknown",
      reason:"deepseek-chat is not a model this registry knows —
              requireKnown was set, so it is not assumed usable" }
resolveModel("deepseek-reasoner", { requireKnown: true })   → samme
resolveModel("deepseek/deepseek-v4-flash", { requireKnown: true }) → samme
resolveModel("deepseek/deepseek-v4-pro",   { requireKnown: true }) → samme

listModels() dækker: anthropic, gemini, openai, mistral.  DeepSeek: 0 rækker.
```

Samtidig i `src/cost/pricing.ts`:

```
deepseek:deepseek-chat           $0.14 / $0.28   version 2026-06-30-deepseek-direct
deepseek:deepseek-reasoner       $0.14 / $0.28   version 2026-06-30-deepseek-direct
openrouter:deepseek/deepseek-v4-pro    $0.435 / $0.87
openrouter:deepseek/deepseek-v4-flash  $0.0983 / $0.1966
```

Og `src/providers/deepseek.ts` er en shippet adapter (F030.2).

### Hvorfor det rammer en der gør som vi siger

Vores egen CLAUDE.md: *"If you are GATING, pass `requireKnown: true`"*. En
forbruger der følger den instruks og kører DeepSeek — en rute vi selv har bygget
adapter til og selv har hentet officielle priser til — får **nej** fra gaten.
To tabeller er uenige, og den ene af dem bestemmer.

Fail-open-designet er ikke fejlen: en utrackt model skal ikke blokeres for
liveness. Fejlen er at DeepSeek ikke ER utrackt i praksis — vi har adapter,
pris og en F-nummereret beslutning om at bruge den (F030). Kun registret ved det
ikke.

### Det bredere hul, ærligt opgjort

Registret dækker 4 providers. Pakken har adaptere til flere (deepseek,
elevenlabs, vertex, azure, bfl, fal, openrouter, deepinfra). **Dette kort retter
DeepSeek**, fordi det er den målte, meldte sag og fordi den har både adapter og
officiel pris. De øvrige er ikke i scope her — men hullet noteres, så den næste
læser ikke tror det er lukket.

### AC

1. `resolveModel("deepseek-chat", { requireKnown: true }).ok === true`, og
   `provider === "deepseek"`. Samme for `deepseek-reasoner`.
2. `listModels()` indeholder DeepSeek-rækker med `provider: "deepseek"`.
3. **En test der binder de to tabeller sammen:** for hver `deepseek:*`-nøgle i
   pricing findes en registry-række. Testen fejler hvis nogen tilføjer en pris
   uden en række — det er præcis den drift der skabte fejlen.
4. `usage.region` for et DeepSeek-kald er uændret (`cn`) — denne rettelse må
   ikke få en ikke-EU rute til at se EU-sikker ud. Test låser det.
5. Ingen ændring i fail-open-adfærden for *rigtigt* utrackede ids:
   `resolveModel("smrt", { requireKnown:true }).ok === false` består stadig.

---

## Hvad vi IKKE gør i dette kort

- **Ingen tier flyttes til DeepSeek.** Registret skal kende ruten; det er ikke
  det samme som at gøre den til nogens default. Enhver tier-ændring er en
  pris- og residens-beslutning og hører til hos ejeren.
- **`bun:sqlite` erstattes ikke med `node:sqlite` eller better-sqlite3.** Det
  ville være en ny runtime-afhængighed og en større beslutning end den meldte
  fejl kræver. Kortet gør fejlen synlig; det skifter ikke motor.

## Rapportér tilbage

Når begge er ude: `ask_peer` til `components` (og videre til pitch, ref 28546)
med version + delta, **formuleret som en dateret måling, ikke som en tilstand.**
Og til Discovery hvis en eksisterende note bliver forkert af rettelsen.

---

## Resultat — 21. september 2026

Begge stories implementeret og verificeret **mod `dist/` under Node**, altså i den
runtime fejlene bor i. `typecheck=0 · test=0 (699 pass) · build=0`.

### F057.1

`requireBun()` i `src/cost/sinks/sqlite.ts` kaster nu i `sqliteSink()` og
`getCostSummary()` — ved OPSÆTNING, ikke ved første `record()`. Beskeden
navngiver Bun-kravet og peger på `upmetricsSink`.

Målt mod `dist/index.js`, Node v25.6.1:

```
sqliteSink({dbPath}) → "sqliteSink requires the Bun runtime: it is backed by
bun:sqlite, which Node cannot import (ERR_UNSUPPORTED_ESM_URL_SCHEME). Use
upmetricsSink() on Node — it is the canonical sink. …"
```

**Mutationsprøve:** fjernes `requireBun("sqliteSink")`, går
`sqlite-node.test.ts` rød med `Expected "threw-on-setup" / Received
"threw-on-record"` — præcis den gamle adfærd. Testen kan altså se fejlen.

`budget-store.ts` er **ikke** rørt. Den fejler fortsat højlydt på Node, og en
test låser den retning fast.

### F057.2

To rækker i `src/availability/registry.ts` (`deepseek-chat`,
`deepseek-reasoner`), hver med en `note` der bærer sunset-datoen og siger at den
ikke er live-verificeret. `pricing-registry-drift.test.ts` binder tabellerne:
hver `deepseek:*`-pris skal have en række, ellers rød — og fejlbeskeden
NAVNGIVER de manglende modeller frem for at sige `0 !== 1`.

**Mutationsprøve:** fjernes rækkerne, går tre tests rød.

### NYT FUND — ikke i pitchs melding, og bevidst ikke lukket her

`providers/deepseek.ts` anbefaler selv `deepseek-v4-flash` fremover ("same
model, not sunset"). Men **målt**: `getPrice("deepseek","deepseek-v4-flash")` er
`undefined` — kun `openrouter:deepseek/deepseek-v4-flash` har en pris.

En forbruger der følger vores egen anbefaling på den direkte API rammer altså
BÅDE en lukket gate OG ingen pris. Vi har **ikke** lagt en registry-række ind
for den, og det er et valg, ikke en forglemmelse: en række uden en pris ville
åbne gaten for en rute der lydløst fakturerer nul — samme grønne fejlretning som
hele dette kort findes for at fjerne.

At lukke det kræver en rate fra en rigtig kilde (pricing-tabellen siger selv
"verify against a real key when it lands"), og en pris må ikke gættes. En test
låser tilstanden og siger hvad der skal ske når raten lander.
**Kandidat til eget kort.**

### Hvad der endnu IKKE er gjort

- **CLAUDE.md-blokken om `@broberg/ai-sdk`** (den hver forbruger-repo læser)
  siger stadig intet om at `sqliteSink` er Bun-only. Den fil genereres af
  cardmem, ikke her — så den går via release-meldingen til components/Discovery.
- **Registret dækker 5 providers** efter dette kort. Adaptere findes til
  elevenlabs, vertex, azure, bfl, fal, openrouter, deepinfra. Noteret, ikke
  lukket.
