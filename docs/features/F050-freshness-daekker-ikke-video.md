# F050 — `pricingFreshness()` er frisk om noget den ikke kan se

**Status:** bygget (0.40.0) · **Prioritet:** høj · **Meldt af:** `super`, 4. september 2026

## Fundet, og hvorfor det er alvorligere end det lød

F046 byggede `pricingFreshness()` **netop for at fange prisdrift**. super brugte den og
målte følgende mod 0.38.0:

```
pricingFreshness()                        { ageDays: 0, stale: false }
listModelPrices().length                  448
enheder i tabellen                        { per_1m_tokens: 448 }   ← ALLE
rækker der matcher veo|kling-video|seedance   0
getModelPrice("veo-3.1-generate-preview") undefined
getModelPrice("mistral-large-latest")     {…}   ← negativ kontrol: opslaget VIRKER
```

Så API'et svarer **«vi har tjekket, og de er friske»** om en tabel hvor per-sekund-priser
**ikke kan eksistere**. Fra kaldestedet er det ikke til at skelne fra at de var dækket.
Det er præcis den fejlform F046 blev bygget for at fjerne — nu i F046 selv.

## Deres to spørgsmål, begge målt her

**1. Rører det månedlige job de håndskrevne priser? NEJ.**

```
VEO_PRICE_PER_SEC          gemini.ts, vertex.ts    håndskrevet
FAL_VIDEO_PRICE_PER_SEC    fal.ts                  håndskrevet
FAL_IMAGE_PRICE_ESTIMATE   fal.ts                  håndskrevet
BFL_IMAGE_PRICE            bfl.ts                  håndskrevet

grep i scripts/build-inventory.ts + gen-pricing.mjs → INGEN træffere
```

De er altså **aldrig blevet opdateret siden de blev tastet ind**, og der findes intet der
kan opdage det. En Veo-pris kan stå forkert i et år mens friskheds-API'et siger 0 dage.

Sammenlign med hvad vi lige har målt på token-siden: **én uge gav 34 prisændringer**, og
to af vores håndskrevne token-priser var forkerte — den ene **3x**. Der er ingen grund
til at tro at video-priser driver mindre; der er kun ingen der har kigget.

**2. `?? 8` — og det er større end super formulerede det.**

```
gemini.ts:372   usage.costUsd = perSec * (req.durationSec ?? 8)
vertex.ts:228   usage.costUsd = perSec * (req.durationSec ?? 8)
fal.ts:180      usage.costUsd = perSec * (req.durationSec ?? FAL_VIDEO_DEFAULT_SEC)
```

Tre steder, ikke ét. Et kald uden `durationSec` faktureres som 8 sekunder **uanset hvad
der faktisk kom retur**. super sagde selv at de brugte tallet som om det var målt og gav
det videre til Christian — det er den konkrete skade.

**Og den rækker længere end en JSDoc.** upmetrics er netop gået i drift med fire etiketter
— `reported` / `computed` / `unpriced` / `untokened` — hvor `reported` betyder «afsenderen
sagde hvad det kostede». Vi sender dem et `usage.costUsd` der her er et **estimat**, og de
kan ikke se forskel. Deres etiket-system er bygget til netop den skelnen, og vi bryder
den opstrøms.

## Omfang

1. **Per-sekund- og per-billede-priser ind i pristabellen** med en rigtig `unit`
   (`per_sec`, `per_image`), så `pricingFreshness()` dækker dem og adapterne læser ÉT
   sted. `ModelPrice.unit` findes allerede og har kun nogensinde båret én værdi — feltet
   blev lavet til netop dette.
2. **Friskheden skal kunne sige hvad den DÆKKER.** Selv efter (1) er svaret «frisk» kun
   sandt om de enheder tabellen fører. `pricingFreshness()` returnerer derfor hvilke
   enheder den har set, så et kaldested kan skelne «dækket og frisk» fra «ikke dækket».
   super foreslog enten-eller; **begge er nødvendige**, fordi (1) alene flytter den samme
   blindhed til næste enhed vi glæmmer.
3. **Et estimeret `costUsd` skal SIGE at det er et estimat.** Enten et felt på `Usage`
   (`costEstimated: true`) eller en anden kanal — men ikke kun en kommentar, for
   upmetrics læser data og ikke vores JSDoc.
4. **Det månedlige job skal røre dem**, eller det skal stå skrevet at det ikke gør. En
   pris der ikke kan opdateres automatisk skal have en `checkedAt` et menneske sætter.

### Ikke-mål

- **Ingen ændring af hvad vi FAKTURERER i dag.** Tallene (Veo 0,40/s, Kling 0,07/s) er
  uændrede og bekræftet af super. Det her handler om at kunne se at de er urevideret.

## Verifikation

- `pricingFreshness()` på en tabel uden per-sekund-rækker skal **ikke** kunne svare
  «frisk» uden forbehold. Mutations-bevis: fjern video-rækkerne igen, og en test skal gå
  rød og NAVNGIVE den manglende enhed.
- Negativ kontrol: en tabel der DÆKKER alle enheder skal svare rent — ellers er
  forbeholdet støj.
- Et kald UDEN `durationSec` skal kunne skelnes fra et med, i det upmetrics modtager.

---

## Hvad der faktisk blev bygget — og hvorfor det blev større end kortet

**Kortet talte om FIRE håndskrevne priskonstanter. Der var FJORTEN.**

AC1 forlangte en test der forbyder *formen* frem for et grep kørt én gang. Den test
fandt de ti resten:

| fil | konstant | enhed |
|---|---|---|
| `elevenlabs.ts` | `ELEVENLABS_PRICE_PER_1K_CHARS` | per_1k_chars |
| `azure.ts` | `AZURE_TTS_PRICE_PER_1K_CHARS` | per_1k_chars |
| `deepl.ts` | `DEEPL_PRICE_PER_1K_CHARS_ESTIMATE` | per_1k_chars |
| `azure.ts` | `AZURE_STT_PRICE_PER_MIN` | per_min |
| `openai.ts` | `WHISPER_PRICE_PER_MIN` | per_min |
| `mistral.ts` | `VOXTRAL_PRICE_PER_MIN` | per_min |
| `mistral.ts` | `MISTRAL_OCR_PRICE_PER_PAGE` | per_page |
| `gemini.ts` | `GEMINI_IMAGE_PRICE_PER_IMAGE` | per_image |
| `openrouter.ts` | `OPENROUTER_IMAGE_PRICE_ESTIMATE` | per_image |
| `fal.ts` | `FAL_TRAIN_PRICE_ESTIMATE` | per_training |

Et grep efter de fire navne super nævnte havde ikke fundet én af dem. Havde vi flyttet
kun de fire, ville `caveats` have meldt «dækket» mens fire andre enheder lå som fire
adapteres private konstanter — nøjagtig samme blindhed, én enhed længere henne. Derfor
seks enheder i tabellen, ikke to.

**Guarden fangede også min egen ufuldstændige oprydning:** to erklæringer jeg havde
fjernet brugen af, men glemt at slette. Den er altså ikke kun et historisk hegn.

### Den fjerde etiket, som ikke stod på kortet

`computeCost()` returnerer 0 for en model uden pris. **Et $0 fordi vi ikke kunne prissætte
og et $0 fordi kaldet var gratis var det samme tal** — og det gratis tilfælde er langt
sjældnere end det ukendte. `costBasis: "unpriced"` skiller dem, og navnet er upmetrics'
eget, så deres etiketter kan blive rigtige om vores rækker.

### Hvorfor det månedlige job RAPPORTERER frem for at spærre

En spærre ingen automatik kan rydde blokerer en udgivelse på et menneskeligt ærinde, og
rettelsen under tidspres er at rykke datoen uden at læse prissiden. Så står spærren grøn
og datoen lyver — værre end ingen spærre. To prøver holder den beslutning fast (steppet
skal findes; det må ikke `exit 1`).

### Beviser

Syv mutationer, hver med rødt der NAVNGIVER defekten:

1. per_sec-rækkerne fjernet → `per_sec: 0 rows — this table cannot price anything billed in per_sec`
2. en håndskrevet pristabel plantet i `openai.ts` → `openai.ts: WHISPER_PRICE_PER_MIN`
3. `costBasis`-stemplet fjernet ét af tre steder → «all THREE of them» rød
4. sink'en skriver fast `"computed"` → læsning tilbage giver `computed ×4` i stedet for fire forskellige
5. sqlite-migreringen fjernet → `table ai_usage has no column named cost_basis`
6. workflow-steppet fjernet → rød
7. workflow-steppet gjort til en spærre → rød

Plus negative kontroller i begge retninger: en tabel der dækker alt svarer uden
forbehold, og scanneren beviser at den KAN se en plantet erklæring (ellers ville en
overivrig kommentar-stripper bestå ved at slette hele filen).

**Persistensen er læst tilbage med en rå forespørgsel**, ikke gennem laget der skrev
den, og med streng lighed på fire forskellige værdier i rækkefølge — et «indeholder»-tjek
ville bestå på en kolonne der gemte den samme streng fire gange.

### Ikke-målet holdt

Veo $0,40/s og Kling $0,07/s uændrede, pinnet af en prøve. Ingen pris flyttede sig.
