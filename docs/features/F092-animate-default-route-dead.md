# F092 — ai.animate's standardrute er død

> Fundet 17/11 2026 under genkontrol af håndholdte priser. High. Effort S. **Afventer ejerens valg af ny standardrute** (pris + region er hans beslutning).

## Summary
`ai.animate` (billede→video) har som standard `gemini / veo-3.1-generate-preview`. Google lukkede Veo 3.1-preview i Gemini API'et 2026-10-22 (og Veo 3.0 2026-06-30). Målt 17/11: `POST …/models/veo-3.1-generate-preview:predictLongRunning` → **404**, og modellen er væk fra Gemini-modellisten (kun `gemini-omni-*` er tilbage). Alle apps der kalder `ai.animate` uden override har fået en fejl siden 22/10.

## Motivation
En standard der fejler er værre end ingen: kalderen kan ikke se hvorfor, og fejlen ligner et nedbrud hos Google. Googles egen anvisning: «Migrate to Gemini Omni Flash (`gemini-omni-1.2-flash`)» — tokenafregnet (5.792 tokens pr. sekund 720p-video), en anden API-form.

## Valgmuligheder (ejerens beslutning)
| | Rute | Region | Pris | Status hos os |
|---|---|---|---|---|
| **A (anbefalet)** | `bfl / flux-3-video` | **EU** (api.eu.bfl.ai) | $0,15/s (hd, målt 20/10) | Bygget (F079.1), live-målt. BFL serverer kun «latest» → floating. Lyd til som standard. |
| B | `vertex / veo-3.1-generate-preview` | EU | $0,40/s | Bygget (F031), men **vores Vertex-projekt har ikke Veo-adgang** (F068, målt). Virker ikke i dag. |
| C | `gemini / gemini-omni-1.2-flash` | US | tokens (~5.792/s) | Ikke bygget — ny adapter-form, ny prisberegning. Googles egen anbefaling. |
| D | `fal / kling 2.5 turbo` | US | $0,07/s | Bygget (F024), målt. Billigst, men US. |

## Reuse
- Dette ER `@broberg/ai-sdk`; alle ruter A, B, D findes allerede. Ingen ny pakke.
- Discovery: ingen anden `@broberg/*`-pakke laver video.

## Design
None — no visual surface.

## Scope
### In scope
- `DEFAULT_ANIMATE_SPEC` flyttes til den valgte rute.
- Fjern de lukkede `gemini:veo-*` fra prisdata/registry (eller markér dem lukket), så ingen vælger dem igen.
- Docs (API.md, CLAUDE.md-tabeller) + Discovery-besked («målt 17/11: Gemini-Veo lukket»).
- Test der fastlåser den nye standard.
### Out of scope
- Omni-adapter (kun hvis C vælges — så bliver det en story for sig).
- Vertex Veo-adgang (F068).

## Stories
- **F092.1** — ny standardrute efter ejerens valg + oprydning + tests + release + besked.

## Acceptance criteria
1. `ai.animate` uden override går til den valgte rute — unit-test.
2. Ingen standard- eller registry-række peger på en lukket Gemini-Veo-model — unit-test.
3. Live: ét kort klip via den nye standard lykkes (pris målt).
4. Release på npm; components informeret med dateret måling.

## Dependencies
Ejerens valg af rute.

## Rollout
Adfærdsændring (standardrute + evt. region + pris) → minor-bump. Den gamle standard virker ikke, så ingen app mister noget der virkede.

## Effort estimate
**S** — ½ dag efter valget (A, B, D); **M** hvis C.
