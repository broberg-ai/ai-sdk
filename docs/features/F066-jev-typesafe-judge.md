# F066 — Jev (TypeSafe) gennem ai-sdk: `ai.judge`

**Bestilt af Christian 1. oktober 2026:** *«Der er en ny model vi skal have åbnet op for
at afprøve. Den hedder Jev. Lav noget research først. Der er en API key til den med $5
på i Global Vault så alle har adgang til at afprøve den. Men alle flådens apps måske
pånær cc skal køre igennem dig for at anvende det.»*

## Research — målt og læst 1. oktober 2026

### Jev er ikke en chatmodel

TypeSafe kalder den en «System One»-model: den genererer ikke tekst, den træffer
**strukturerede beslutninger** med kalibrerede sandsynligheder. Man sender et
`state` (indholdet) og et kort af `questions`, og hvert spørgsmål er én af tre typer:

| type | spørger | svarer |
|---|---|---|
| `noul` | ja/nej | `noul`: sandsynlighed 0–1 for ja |
| `choice` | vælg én af et lukket sæt | `choice`, `probabilities` pr. mulighed, `confidence` |
| `score` | karakter efter beskrevne niveauer (2–10) | `score` (kan falde mellem niveauer), `probabilities`, `legend`, `confidence` |

Flere spørgsmål i ét kald (deres egen måling: 13 spørgsmål samlet er 12,2× billigere
og 10× hurtigere end hver for sig). Eget JSON-format — **ikke** OpenAI- eller
Anthropic-kompatibelt. Derfor hører den IKKE hjemme i `ai.chat`.

### API — dokumenteret og verificeret med et rigtigt kald

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`
- Modeller: `jev-1.13.0` (fast), `jev-latest` og `jev-preview` (aliaser der flytter
  sig ved nye udgivelser — fastgør versionen hvis man har tunet tærskler på confidence)
- 64k tokens pr. kald (state + alle spørgsmål); 32k for state + længste spørgsmål.
  Kun tekst.
- 100k tokens/s og 40 kald/s, «adjusting dynamically». 429 ved loft, 529 ved overload.
- **Live, 1/10:** ét kald med en dansk kundehenvendelse og tre spørgsmål → HTTP 200 på
  0,35 s, `model: "jev-1.13.0"` (jev-latest opløst), alle tre svar plausible. 429 input-
  og 73 output-tokens. **Ét eksempel er ikke en måling af dansk** — kun at det ikke
  faldt på dansk her.
- **Drift i dokumentationen:** hvert svar bærer et `type`-felt, som deres eksempel ikke
  viser. Vi læser det ikke som påkrævet.

### Pris

**$0,042 pr. million INPUT-tokens. Output er gratis.** Under halvdelen af vores
billigste tekst-tier (mistral-small, $0,10). Kaldet ovenfor kostede ca. $0,000018.
Pr. indsat dollar ≈ 24 mio. input-tokens. (Beløbet på kontoen nævnes bevidst ikke — det
ændrer sig, og den første angivelse her var allerede forkert dagen efter.)

### Residens — og den er AMERIKANSK

- Privatlivspolitikken: *«The Services are hosted in the United States.»*
- Selskab: TypeSafe AI, Inc. Land og adresse ikke oplyst.
- Databehandleraftale: EU-SCC'er (modul 2 og 3) + UK-tillæg. Ingen EU–US Data Privacy
  Framework. Opbevaring «så længe det er nødvendigt» — intet tal.
- **Nul-lagring (ZDR) kun for enterprise-kunder.** Med en almindelig nøgle gemmes input.
- **De træner ikke på input:** *«We will not train or fine tune any artificial
  intelligence or machine learning models on your prompts or other Input.»*
- **Fælde målt:** svaret kom fra Cloudflares kant i KØBENHAVN (`cf-ray: …-CPH`). Det er
  ikke behandlingsstedet. En vært bag et CDN kan ikke afgøre residens ud fra hvor den
  svarer fra.

**Konsekvens, og den er flådens faste regel, ikke en ny beslutning:** Jev må ikke bruges
på person-, kunde- eller helbredsdata. `api.typesafe.ai` registreres som `"us"`, så
`usage.region` og `regionOfHost` siger det rigtige, og en EU-vagt afviser den.

## Reuse (F217 — obligatorisk)

Discovery 1/10, `?q=typesafe`, `?q=jev`: intet. `?q=evaluation decision model`: kun
`@broberg/ai-sdk` selv. **Beslutning: BYG** — en tynd fetch-adapter i ai-sdk, som
flådens regel kræver. Ingen TypeSafe-SDK (`@typesafe/...`) som afhængighed: «no raw
provider SDKs».

## Design

**Ny kapabilitet `ai.judge`, der eksponerer de tre primitiver typet og uændret** —
ikke presset ind i `chat` eller `contracts.classify`. Formatet er unikt, og en tynd,
ærlig gennemføring er det mindste der virker.

```ts
const { answers, usage } = await ai.judge({
  state: "…",                                  // tekst eller JSON
  questions: {
    urgent: { type: "noul", instructions: "…" },
    team:   { type: "choice", instructions: "…", criteria: { billing: "…", technical: "…" } },
    mood:   { type: "score", instructions: "…", criteria: ["Rolig", "Frustreret", "Vred"] },
  },
});
answers.team.choice; answers.team.confidence; answers.urgent.noul;
```

- Udbyder `typesafe`, standardmodel `jev-latest`, nøgle fra `TYPESAFE_API_KEY`.
  **Ship dark:** uden nøgle sker intet før nogen kalder `judge`, og så en klar fejl.
- `override:{ provider:"typesafe", model:"jev-1.13.0" }` for at fastgøre versionen.
- Vært ét sted (`DEFAULT_BASE_URLS.typesafe`), som F056.1 kræver.
- Pris i `pricing.ts` for `jev-1.13.0`; omkostningen regnes på den model der FAKTISK
  svarede (svaret siger `jev-1.13.0` også når man beder om `jev-latest`). En fremtidig
  version uden pris bogføres ærligt som `unpriced`, ikke som $0 der ligner en måling.
- Registry-rækker for `jev-1.13.0` og `jev-latest`, så `requireKnown` slipper igennem.
  `jev-latest` er IKKE et alias for 1.13.0 hos os — det er det kun indtil de udgiver.
- Ingen genforsøg i adapteren (som de andre adaptere). 429/529 bliver en fejl med status.

## Ikke i scope

- `contracts.classify` via Jev. Oplagt — en `choice` er en klassifikation med
  kalibreret confidence — men det er en adfærdsændring for en eksisterende funktion og
  hører i sit eget kort når nogen har prøvet `judge`.
- Delt forudbetalt prøvenøgle er Christians bevidste valg for en prøveperiode («så alle har
  adgang»). Det står i modsætning til «én Mistral-konto pr. repo», men den beslutning
  gælder Mistral og drift, ikke en prøvenøgle. Noteret, ikke udfordret.

## AC

1. `ai.judge` sender præcis det dokumenterede format til `/v1/systemone` med Bearer-
   nøglen, og returnerer typede svar for alle tre spørgsmålstyper.
2. Live-verificeret mod TypeSafe med vault-nøglen: ét kald, tre spørgsmålstyper, svar
   læst tilbage — ikke kun mocket.
3. `usage.region` er `"us"` for et Jev-kald, og `regionOfHost("api.typesafe.ai")` er `"us"`.
4. Omkostning: input × $0,042/M, output gratis, regnet på den model der svarede; en
   ukendt version bogføres `unpriced`.
5. Uden `TYPESAFE_API_KEY`: `createAI()` virker, og først et `judge`-kald fejler med en
   besked der navngiver variablen.
6. Ugyldigt input (tom `questions`, `choice` uden `criteria`, `score` med <2 niveauer)
   afvises ved grænsen med en ZodError, før noget sendes.
7. `resolveModel("jev-1.13.0", {requireKnown:true})` og `"jev-latest"` er `ok`.
8. Dokumentationen siger højt: US-hostet, ikke til persondata, aliaser flytter sig.
9. Udgivet, og components har fået en dateret melding til Discovery.
