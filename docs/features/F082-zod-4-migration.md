# F082 — zod 3 → 4.6.6+ (GHSA-mrhx-c7xc-m3w5)

> Sikkerhed, high. Effort S–M. Status: backlog, venter på Christians go (breaking for nogle forbrugere).

## Summary
ai-sdk bruger zod 3, som har en sårbarhed: et meget stort array i input får valideringen til at bruge masser af hukommelse og tid. Der kommer ingen rettelse til zod 3, så ai-sdk skal over på zod 4.6.6 eller nyere. Det udgives som en minor-version med en tydelig note, fordi forbrugere der giver deres egne zod-skemaer til contracts kan blive berørt.

## Motivation
Flåde-sikkerhedsalarm 24/10 2026 (buddy, Christians ordre via bid): GHSA-mrhx-c7xc-m3w5, high — z.array()/z.set() validerer hvert element, også når .max() er overskredet. buddy målte zod 3.25.76: 200.000 elementer → 200.001 fejl, 46 MB, 1,4 s. 4.6.7 stopper efter én fejl. En grænse på request-størrelse er ikke en rettelse (200k elementer er under 2 MB JSON).

Målt i ai-sdk 24/10: `zod` dependency `^3.23.8`, installeret 3.25.76. zod bruges i `src/schema/inputs.ts` (17 `z.array()` uden `.max()`, fx chat-beskeder) og via `z.ZodType<T>` i `src/capabilities/contracts/types.ts`, hvor forbrugerens eget skema køres på LLM-output. ai-sdk har ingen HTTP-server; risikoen opstår når en app sender et uprøvet request-body direkte ind i ai.chat m.fl.

## Solution
Opgradér `zod` til `^4.6.6` (seneste stabile ved implementering), ret inputs.ts til zod 4-API'et, og gør contracts-typen kompatibel med forbrugerskemaer. Overvej `.max()` på arrays i inputs.ts hvor der findes en naturlig grænse — men kun hvis grænsen ikke afviser legitime kald.

## Reuse
None — no cross-cutting capabilities (en afhængighedsopgradering i pakkens eget skema).

## Design
None — no visual surface.

## Scope

### In scope
- `package.json` zod → `^4.6.6`; `bun.lock` opdateret.
- `src/schema/inputs.ts`, `src/client.ts` (aiConfigSchema), `src/capabilities/contracts/*` tilpasset zod 4 (fx `z.record` med to argumenter, fejlbeskeder, `.strict()`-semantik).
- Regressionstest: et array med 200.000 elementer i et input-felt med `.max()` afvises hurtigt (målt tid/hukommelse i testen).
- Release-note: hvad forbrugere på zod 3 skal gøre, hvis de bruger contracts med egne skemaer.

### Out of scope
- Migrering af zod i andre repoer (hver ejer sin egen).
- En HTTP-størrelsesgrænse (ai-sdk har ingen server).

## Architecture

### Forbrugerskemaer i contracts
`contracts.extract({ schema })` tager forbrugerens `z.ZodType<T>`. En forbruger på zod 3 der giver et zod 3-skema til en ai-sdk på zod 4 kan få typefejl. Valg tages i F082.1 efter måling: (a) kræv zod 4 hos forbrugeren, eller (b) typé parameteren strukturelt (`{ parse(x: unknown): T }`) så begge virker. (b) foretrækkes hvis den holder under `strict`.

## Stories
- **F082.1** — zod 4.6.6+ i ai-sdk, grøn suite, regressionstest for store arrays, release-note.

## Acceptance criteria
1. `npm ls zod` i repoet viser kun zod ≥ 4.6.6 (målt i repoet efter install).
2. Hele test-suiten er grøn i CI på release-commit'en.
3. Ny test: 200.000-elements array mod et `.max()`-felt i inputs.ts afvises på under 100 ms (målt i testen).
4. contracts.extract virker med et skema bygget af forbrugerens zod 4 — og adfærden for zod 3-skemaer er målt og skrevet i release-noten.
5. Den nye version er på npm (registry dist-tags.latest), og buddy + components har fået besked.

## Dependencies
None.

## Rollout
Minor-bump. Forbrugere på caret under 1.0 får den ikke automatisk — de bumper bevidst. Rollback: forbrugere bliver på forrige minor.

## Open Questions
1. Strukturel type (b) vs krav om zod 4 hos forbrugeren (a) — afgøres ved måling i F082.1.
2. Christians go til en minor der kan bryde forbrugere med egne zod 3-skemaer.

## Effort estimate
**S–M** — ½–1 dag.
