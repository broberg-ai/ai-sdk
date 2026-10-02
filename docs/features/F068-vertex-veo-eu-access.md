# F068 — EU-video via Vertex Veo virker ikke

## Målt 3. oktober 2026

Ved et forsøg på at lave en Trail-video med `ai.animate({ override:{ provider:"vertex", … } })`
svarede Vertex 404 på alle forsøg:

> «Publisher model `projects/gen-lang-client-0601339034/locations/<region>/publishers/google/models/<model>` was not found or your project does not have access to it.»

| model | region | svar |
|---|---|---|
| veo-3.1-fast-generate-preview | europe-west1 | 404 |
| veo-3.1-fast-generate-001 | europe-west1 | 404 |
| veo-3.0-fast-generate-001 | europe-west1 | 404 |
| veo-3.1-fast-generate-001 | europe-west4 | 404 |

Ingen af kaldene kostede noget. Videoen blev i stedet lavet via fal Kling 2.5 Turbo Pro (US).

## Hvorfor det betyder noget

F031 (`vertexAdapter.animate`) blev bygget og testet med kun mocked fetch. Den er aldrig
live-verificeret. CLAUDE.md nævner Vertex som EU-rute for video-**analyse** (`ai.video`,
live-verificeret 2026-08-11). Video-**generering** via Vertex er ikke bevist, og en læser kan
let tro, at de to er det samme.

## Mulige årsager (ikke målt)

- Vertex AI API er ikke slået til for projektet, eller Veo kræver særskilt adgang i Model Garden.
- Veo er ikke udrullet i de EU-regioner vi prøvede.
- Model-id'erne på Vertex hedder noget andet end på Gemini API'et.

## Løsning

1. Slå Vertex AI API og Veo til for projektet (ejerens konsol):
   - https://console.cloud.google.com/apis/library/aiplatform.googleapis.com?project=gen-lang-client-0601339034
   - https://console.cloud.google.com/vertex-ai/model-garden?project=gen-lang-client-0601339034
2. Find et model-id og en EU-region der svarer 200, og bevis det med ét live kald.
3. Lykkes det ikke: skriv i docs/API.md, med dato, at EU-video-generering via Veo ikke er tilgængelig på vores projekt.

## Reuse

Ingen ny kode forventes, kun konfiguration og et model-id. Adapteren `src/providers/vertex.ts` genbruges.

## Stories

- F068.1 — Få Veo live på Vertex i en EU-region, eller dokumentér at det ikke kan.
