# F059 — Et ulæseligt svar må ikke ødelægge en måling af 444 eksempler

**Bestilt af trail, 22. september 2026**, med en måling bag sig og en skarpere
formulering end den jeg tilbød.

Jeg spurgte: *skal et uparseligt modelsvar være en VÆRDI frem for et kast?*
Trails svar var ikke ja eller nej, men **«lad kalderen vælge»** — et flag på
kaldet, ikke en ny returform for alle.

## Hvorfor kastet er rigtigt i produktbrug og destruktivt i eval-brug

`contracts.classify()` kaster i dag når modellen svarer noget der ikke indeholder
JSON (`parseJsonLoose`: «no JSON found in model output»). **Det er den rigtige
adfærd i produktion** og ændres ikke: en nægtelse eller et udfald er ikke en
klassifikation, og et kast er det højlydt ærlige svar.

I en MÅLING er det noget andet. Trails ord:

> *«444 eksempler i én batch. Et kast midt i den er ikke oplysende, det er
> destruktivt — det stopper løkken på eksempel 212, og de 232 der ikke blev målt,
> ser bagefter ud som om de ikke fandtes.»*

Og konsekvensen af ikke at bygge det: *«Vi pakker i try/catch og TÆLLER dem, og
så har vi bygget jeres outcome-felt i hånden, dårligere.»* Det er argumentet.
Kapabiliteten bliver bygget uanset — spørgsmålet er kun om den bliver bygget én
gang her eller n gange i forbrugernes harnesses.

## Hvorfor `outcome` er nødvendigt og ikke pynt

Trail skal kunne tælle **tre** ting hver for sig: *tog fejl* · *svarede uden for
menuen* · *kunne ikke læses*. I dag kan de to sidste ikke skelnes når kastet
fjernes — begge giver `label: null`, og `rawLabel` er sat i begge tilfælde.

Så diskriminatoren er ikke valgfri; uden den er flaget ubrugeligt til det den
blev bestilt til. Det er samme argument components førte om `fallbackUsed` mod
`outcome`: **et felt kan destruktureres væk, en værdi man er nødt til at læse
kan ikke.** Her er `outcome` netop den værdi.

## Reuse (F217 — obligatorisk)

Discovery-tjek 22/9 2026, `?q=zero-shot classification`: kun `@broberg/lens*`
kommer retur, som er browser-automatisering og ikke i nærheden. **Beslutning:
BYG.** `contracts.classify` er vores egen kapabilitet; der findes intet
`@broberg/*` der klassificerer tekst. Ingen rå provider-integration
introduceres.

## Design — to felter, det ene valgfrit

```ts
// ALTID til stede. Additivt, ingen brudflade.
outcome: "answered" | "out-of-set" | "unparseable"

// Opt-in. Default er "throw" = nøjagtig dagens adfærd.
classify({ …, onUnparseable: "throw" | "value" })
```

| modellen svarede | `label` | `rawLabel` | `outcome` | default | `onUnparseable:"value"` |
|---|---|---|---|---|---|
| en etiket i listen | etiketten | — | `answered` | returnerer | returnerer |
| en etiket UDEN for listen | `null` | svaret | `out-of-set` | returnerer | returnerer |
| slet ingen JSON | `null` | rå tekst | `unparseable` | **KASTER** | returnerer |

**Default ændres ikke.** En eksisterende forbruger ser kun et nyt felt.

## AC

1. `outcome` er sat korrekt på alle tre stier, og `answered` ⟺ `label !== null`.
2. Default er uændret: uden `onUnparseable` KASTER et svar uden JSON stadig, med
   samme besked. En test låser det.
3. `onUnparseable: "value"` returnerer i stedet
   `{ label: null, rawLabel: <rå tekst>, confidence: null, outcome: "unparseable" }`
   og kaster IKKE.
4. **Trails egentlige prøve:** en løkke over N inputs hvor ét er ulæseligt
   gennemfører alle N med `"value"` — og afbrydes ved default. Det er den der
   beviser at kortet løser det bestilte, frem for at feltet findes.
5. `out-of-set` og `unparseable` kan skelnes uden at læse `rawLabel`s indhold —
   de tre tal kan tælles hver for sig.
6. Mutationsprøvet: fjernes diskriminatoren, går prøven for (5) rød.
7. Ingen ændring for `rerank` eller de øvrige contracts. Ikke bestilt.

## Ikke i scope

- **`rerank` får ikke samme flag.** Trail bad ikke om det, og en symmetri ingen
  har bedt om er den slags spekulativ flade der skal begrundes af en måling.
  Noteret, ikke bygget.
- **`outcome` bliver ikke en erstatning for `label`.** Begge står; `label` er
  stadig det felt en produktforbruger læser.
