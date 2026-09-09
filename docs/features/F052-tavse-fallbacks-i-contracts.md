# F052 — en tavs fallback i `contracts`: «modellen valgte det» og «jeg kunne ikke læse svaret» er samme værdi

**Meldt af:** `helpdesk` via `components`, 9. september 2026 · **Målt mod:** 0.41.1's dist OG kilden

## Fundet

```ts
// classify
const label = input.labels.includes(parsed.label ?? "") ? parsed.label! : (input.labels[0] ?? "");
const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;

// rerank
const ranked = (Array.isArray(raw) ? raw : [])
  .map((r) => ({ item: String(r.item ?? ""), score: typeof r.score === "number" ? r.score : 0 }))
```

**Fem overlæsninger, hvor to tilstande deler én værdi:**

| sted | «modellen svarede» | «vi kunne ikke læse det» |
|---|---|---|
| `classify.label` | `labels[0]` | `labels[0]` |
| `classify.confidence` | `0` | `0` |
| `rerank.ranked` | `[]` | `[]` |
| `rerank[].item` | `""` | `""` |
| `rerank[].score` | `0` | `0` |

**Hvorfor det bider konkret.** helpdesk klassificerer en support-henvendelse mod
TENANTENS egen intent-taksonomi, og resultatet styrer **hvilket autonomi-niveau svaret
får**. En uklassificerbar henvendelse lander derfor på tenantens første intent — valgt
af rækkefølgen i en konfigurationsfil — og får et autonomi-niveau begrundet i en
array-orden. Ingen fejl, intet log-spor, et selvsikkert svar.

## To rettelser af meldingen, begge fundet ved at måle den

**1. Hullet var SMALLERE end beskrevet — og det farligere af de to halvdele.**
Meldingen sagde at fallbacken fyrede på «ulæseligt ELLER ukendt etiket». Målt: et svar
uden JSON i sig kastede allerede (`parseJsonLoose`) og gør det stadig. Den tavse
fallback fyrede derfor **kun** på et *parsebart* svar der navngav en ukendt etiket.

Det er den værste af de to, ikke den mildeste: et afslag eller et udfald ligner ikke en
klassifikation, men et parsebart svar med en forkert etiket **ligner en rigtig
klassifikation**. Så rettelsen rammer det rigtige sted — men vi koder efter målingen,
ikke efter beskrivelsen. `classify` kaster fortsat på et svar uden JSON, med vilje.

**2. `rerank`s tomme array havde to indgange, og kun den ene var åben.** Et svar helt
uden JSON kastede allerede. Hullet var **gyldig JSON der ikke er et array** — et objekt,
en streng. Det er den nye `throw`.

## DEFEKTEN HAVDE EN BESTÅENDE PRØVE DER FORSVAREDE DEN

Suiten var grøn, og den prøve der gjorde den grøn hed:

```
test("classify falls back to first label when model returns an unknown label")
  expect(res.label).toBe("a");
```

Fallbacken var altså ikke en forglemmelse — nogen (vi) skrev en prøve der fastholdt den
som ønsket adfærd. **En grøn suite var bevis om HENSIGT, ikke om rigtighed.** Det er
værd at sige rent ud, fordi det er den ene form mutations-testning ikke fanger: en
mutation gør prøven rød, prøven er «god», og den beskytter det forkerte.

## Det der gør det til ÉT mønster og ikke fem fejl

`extract` i samme fil gør det allerede rigtigt: `input.schema.parse(...)` **kaster** på
et ulæseligt svar, med ét genforsøg først. Så én af tre kontrakter har svaret, og de to
andre har det ikke. **Det er beviset for at rettelsen er mulig i netop denne kodebase**
— det er ikke en designbegrænsning, det er en udeladelse.

Det er også sessionens egen gennemgående fejlform, nu inde i vores egen pakke: *et grønt
svar fra det forkerte lag.* Og det er ordret samme form som `@broberg/secret-scan`s tomme
`findings`-array, som helpdesk selv citerede — i nabofunktionen.

## Rettelsen

**`classify`:** `label: string | null` — `null` når modellens svar var ulæseligt eller
navngav en etiket der ikke står i `labels`. `confidence: number | null` — `null` når
modellen ikke rapporterede nogen; `0` er en ægte konfidens. Modellens rå svar bevares i
`rawLabel` så et kaldested kan logge hvad der faktisk kom.

**ÉT felt, ikke to.** helpdesk foreslog `matched: boolean` ELLER `label: string | null`.
`null` er nok — `matched` ville være afledt af det, og to felter der skal holdes ens er
F050.3's fejl igen. Det svarer også på components' advarsel om at «et felt der
rapporterer sin egen tilstand ikke er et bevis»: der er ikke noget felt at hardkode,
fordi `null` ER signalet.

**`rerank`:** et svar der ikke er et array **kaster** (som `extract`). Poster hvis `item`
ikke findes i `input.items` droppes — modellen har opfundet dem. Poster uden brugbar
score droppes og navngives i et nyt `unscored: string[]`, så `ranked` kun indeholder
ægte, scorede elementer og det manglende er synligt som DATA.

## BRYDENDE, sagt ligeud

`label: string | null` og `confidence: number | null` er **oversættelses-brud** i et
minor-bump. Det er hensigten — en `label` man kan læse uden at forgrene er præcis
defekten — men vi har sagt «det kan ikke bryde nogen» om et minor før og taget fejl
(0.35, `arguments` blev valgfri), så det står skrevet frem for at blive opdaget.

**Og én ting der SKAL siges til helpdesk:** deres nuværende afbødning hviler på at
fallbacken **er** `labels[0]` — de sender «ukendt» som første etiket. Efter denne
ændring får de `null` i stedet. Under `strict` er det et oversættelses-brud (højlydt,
godt); uden `strict` flyder `null` igennem. De skal vide præcis hvad vi valgte, før de
opgraderer.

## Ikke-mål

- **`extract` røres ikke.** Den er allerede rigtig, og at «harmonisere» den ville være en
  ændring uden en defekt bag.
- **Ingen ny retry-logik.** Kontrakten er at sige sandheden om svaret, ikke at forbedre
  svaret.

## Verifikation

- Mutation pr. dør: gendan hver af de fem overlæsninger → en NAVNGIVEN prøve rød.
- **Negativ kontrol i begge retninger:** et gyldigt svar skal give `matched`-tilstanden
  uden forbehold — ellers er `null` blevet ubetinget støj. Og `confidence: 0` fra
  modellen skal komme igennem som `0`, ikke som `null`; det er hele skelnen.
- `rerank` med et gyldigt svar: `unscored` er tom. Med et halvt svar: de manglende
  navngives. Med skrald: kaster.

## Reuse

Discovery-søgt 9. september 2026 på `classify`, `rerank`, `llm json`. Ingen delt
`@broberg/*`-pakke ejer LLM-kontrakter — det er denne pakkes eget domæne
(`src/capabilities/contracts/`). Intet at genbruge, ingen ny pakke at bygge.
