# F054 — `euOnly`: en spærre der fejler LUKKET, frem for tre hjemmestrikkede kopier

**Foreslået af:** `trail` via `components`, 9. september 2026 · **Status:** kortlagt, ikke bygget

## ÅBNE SPØRGSMÅL — læs disse først

1. **Fallback-kæden.** Skal `euOnly` afvise en kæde der INDEHOLDER en ikke-EU-kandidat
   allerede ved opsætningen, eller først når den rute faktisk tages? Det første fejler
   tidligt og forudsigeligt; det andet lader et kald lykkes i dag og fejle i morgen når
   den primære rute er nede — altså præcis når ingen kigger.
2. **Hvad tæller som EU for en model vi ikke kender?** Se «Fail-open-fælden» nedenfor.
3. **Gælder flaget pr. kald, pr. klient, eller begge?** En klient-indstilling er den der
   rent faktisk beskytter et helt repo; et pr.-kald-flag beskytter kun de kaldesteder
   nogen huskede.

## Foranledningen

`ai.embedding` går som standard til `openai:text-embedding-3-small` — USA. **Intet
fejler når man glemmer sin override.** Kaldet lykkes, svaret ser rigtigt ud, teksten er
i USA.

trail bygger et RAG-indeks over Neuroner der indeholder Sannes klient-tekster — en
zoneterapi-klinik, altså helbredsoplysninger, særlig kategori under GDPR art. 9. De
bruger override'en og har skrevet et acceptkriterium på svaret. **Men det er deres test i
deres repo; den næste der bygger med embeddings har den ikke.**

## Hvorfor det er en reuse-sag og ikke en feature-ønske

**Tre repoer har nu hver sin hjemmestrikkede udgave af samme spærre:**

| repo | form | hul |
|---|---|---|
| `buddy` (F242.2, august) | `euOnly` → `assertEuProvider()` | provider-NAVN |
| `trail` | `provider !== EMBEDDING_PROVIDER` → throw | provider-NAVN |
| `helpdesk` | `usage.region !== "eu"` | ingen — og de har en regel mere end os |

De to første deler præcis det hul vores egen `.d.ts` advarer imod med versaler: **en
gateway foran Mistral hedder stadig «mistral»**, matcher navnet, og passerer. Det er
også den fejl vi selv lukkede i 0.36.0, da navnetabellen lavede en falsk EU-påstand i
det modul der var skrevet for at forhindre falske EU-påstande.

**helpdesk har en regel vi ikke har, og den skal med:** et svar UDEN brugbar `usage`
afvises som uden for EU. *«Vi kan ikke se hvor det var»* og *«det var fint»* må ikke give
samme resultat — samme fejlform som `classify`s gamle `labels[0]`.

## FAIL-OPEN-FÆLDEN, som components fandt

`resolveModel` er **fail-open** på et ukendt id: `ok:true`, `status:"unknown"`, og
`model` er ens eget input ekkoet tilbage. Det er rigtigt for liveness — bloker aldrig en
model vi bare ikke sporer — og **forkert for en gate**.

Bygges `euOnly` oven på registret uden `requireKnown`, bliver **en ukendt model til en
tavs EU-godkendelse.** Det er den værst tænkelige udgang for netop denne funktion: en
spærre der siger ja til det den ikke kender.

Så: **`"unknown"` er ikke-EU.** Ikke «sikkert nok», ikke «formentlig fint». Den eneste
positive påstand er `"eu"`.

## Skitse (ikke besluttet)

```ts
const ai = createAI({ residency: "eu" });     // klient-niveau
await ai.embedding({ text, residency: "eu" }); // eller pr. kald
```

Spærren læser **`regionOfHost` på den vært hver kandidat i kæden ville ramme**, før
noget sendes — ikke `regionOfProvider`, ikke et navn, ikke en allowlist. Efter kaldet
bekræfter den mod `usage.region`, så en fejl i vores egen tabel ikke passerer ubemærket.

**Begge halvdele, ikke den ene.** Kun `regionOfHost` er en påstand om vores tabel; kun
`usage.region` kommer for sent til at forhindre noget.

## Ikke-mål

- **Ingen automatisk omrutning til en EU-model.** Beslutningsregistret afviser det
  eksplicit: `mistral-embed` har 1024 dimensioner mod standardens 1536, så et stille
  skift ville skrive vektorer i en anden form ind i et kørende indeks uden at fejle.
  **Spærren afviser; den vælger ikke.**
- **Ingen ændring af tier-defaulterne.** Samme grund.

## Verifikation

- Hver kandidat i en fallback-kæde prøves, ikke kun den primære — **mutation: fjern
  spærren fra fallback-grenen alene, og en navngiven prøve skal gå rød.** Det er den
  eneste af prøverne der beviser noget de tre hjemmestrikkede udgaver ikke allerede kan.
- En ukendt model/vært → afvist. Negativ kontrol: en KENDT EU-vært → godkendt, ellers er
  spærren bare en afvisning af alt (det var netop `regionOfProvider`-fælden).
- Et svar uden brugbar `usage` → afvist (helpdesks regel).
- Uden flaget er adfærden byte-identisk med i dag.

## Reuse

Discovery-søgt 9. september 2026 på `residency`, `gdpr`, `eu guard`. Ingen delt
`@broberg/*` ejer dette — og det er hele pointen: tre repoer har bygget det lokalt fordi
pakken ikke havde det. Den hører her, hos den der ser alle udbyderes værter.
