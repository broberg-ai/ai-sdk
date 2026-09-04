# F050 — `pricingFreshness()` er frisk om noget den ikke kan se

**Status:** planlagt · **Prioritet:** høj · **Meldt af:** `super`, 4. september 2026

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
