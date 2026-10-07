# F070 — ai.vectorize: billede til SVG via Recraft

**Bestilt 7. oktober 2026** af Christian via buddy (#2011): *vektorisér hans gamle ODEUM-logo til SVG via Recraft, vi har credits dér … Mangler den, så byg den ind i pakken (ai.image vectorize eller lignende med cost-tracking) frem for et rå kald — det er flådereglen.*

## Målt 7. oktober 2026

- @broberg/ai-sdk har ingen vektorisering. Recraft findes kun som prisrækker for billed-generering via OpenRouter.
- Recrafts API (docs læst 2026-10-07): `POST https://external.api.recraft.ai/v1/images/vectorize`, `Authorization: Bearer RECRAFT_API_TOKEN`, JSON `{ image_url }` (URL eller data-URL) eller multipart `file`; valgfri `shape_stacking` (`hierarchical` | `cut_out`) og `response_format` (`url` | `b64_json`). Svar: `{ created, credits, image: { image_id, url } }`; url'en peger på en SVG og glæder ~24 t. Input: PNG/JPG/WEBP, < 20 MB, ≤ 16 MP, sider 256–4096 px. Pris: **$0,01 pr. kald**.
- ai-sdk har allerede `RECRAFT_API_TOKEN` i sin vault.

## Løsning

- `recraftAdapter` med `vectorize()`; registreret i `defaultProviders` som `recraft`.
- `ai.vectorize({ image, shapeStacking?, override?, labels? })` → `{ svg, usage }`. SVG'en hentes med det samme, så kalderen ikke afhænger af en url der udløber.
- Pris: `recraft:vectorize` $0,01 pr. billede i media-prisbogen; region fra værten.
- Ship dark: uden nøgle kaster kun `vectorize`.

## Reuse

Ingen ny pakke. Recraft er ikke i nogen `@broberg/*`-pakke; ai-sdk er flådens AI-dør. Mønstret følger de eksisterende enkelt-kapabilitets-adaptere (deepl, typesafe).

## Ude af scope

Efterbehandling af SVG'en (fx at samle trinvise farvebånd til en `<linearGradient>`) er ikke en del af SDK'et; det gøres pr. opgave.

## Stories

- F070.1 — recraftAdapter + ai.vectorize + pris + tests.
