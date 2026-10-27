# F084 — ai.image via Mistral (billedværktøjet i Conversations API)

> Meldt af jam (F023.12) 27/10 2026 via components. High. Effort S. Status: i gang.

## Summary
`ai.image` kan lave billeder via Mistral, betalt af den Mistral-nøgle en org allerede har (BYOK). Mistrals billedværktøj kaldes gennem deres Conversations API; billedet kommer tilbage som et midlertidigt link, præcis som BFL-vejen i dag.

## Motivation
Jamai (jam) skal lave billeder på kundens egen Mistral-nøgle i stedet for en ny BFL-nøgle. `ai.image` kender i dag kun fal (standard, US) og BFL (EU). Jam bygger ikke en rå fetch, mens de venter.

## Solution
`mistralAdapter.image()` sender ét kald: `POST /v1/conversations` med `{ model, inputs, tools:[{type:"image_generation"}], store:false, instructions }`, læser `outputs[type=tool.execution].info.result` (JSON med `url`) og returnerer `{ url, usage }`.

**Målt 27/10 med vores nøgle:**
- Ingen agent nødvendig — inline `model` + `tools` virker. Med `store:false` gives ingen `file_id`, kun en URL.
- URL'en peger på `mistralaiblackforestprod.blob.core.windows.net` (Black Forest Labs bag Mistral), gyldig 1 time (`se=`), JPEG 1152×896.
- Lageret resolver til `blob.gvx11prdstr02a.store.core.windows.net` — `gvx` er Azures kode for Sweden Central [Likely, ikke dokumenteret af Mistral].
- Virker med mistral-small-2603 (7 s, 173 ind/360 ud), mistral-large-2512 (11 s) og mistral-medium-2604 (10 s). `usage.connectors.image_generation = 1`.
- Pris: ikke på Mistrals pricing-side («tool APIs are priced per call»). To tredjepartsguider: $100/1.000 billeder = $0,10/billede + tokens [Likely].

## Reuse
None — udvidelse af eget `mistralAdapter` (`key()`, `regionOfHost`, `freshUsage`, `getMediaPrice`). Ingen ny pakke.

## Design
None — no visual surface.

## Scope

### In scope
- `src/providers/mistral.ts`: `image(req)`; `instructions` beder modellen kalde værktøjet én gang og svare kort (spar output-tokens).
- Model = `req.spec.model` (en Mistral-chatmodel; `mistral-small-2603` anbefalet).
- Usage: tokens prissat via eksisterende pris for chatmodellen + $0,10 pr. billede fra `media-pricing.ts` (`mistral:image_generation`), `costBasis: "estimated"` (prisen er ikke bekræftet af Mistral). Region fra `regionOfHost(baseUrl)`.
- Ikke understøttet og KASTER (aldrig tavst): `width/height`, `referenceImages`, `finetune`, `loras`, `seed`, `outputFormat` — med besked der peger på bfl.
- Fejl: intet `tool.execution`-resultat (modellen valgte ikke at tegne) kaster med modellens tekst.
- BYOK: virker via `byokAdapter(mistralAdapter, { apiKey })` (nøglen er den eneste credential).
- Docs (`docs/API.md`), registry-note, udgivelse, besked til jam + components.

### Out of scope
- At gøre Mistral til standard-billedrute.
- Billedredigering / reference-billeder via Mistral.
- `store:true` + `file_id`-download (URL er nok og gemmer intet hos Mistral).

## Stories
- **F084.1** — `mistral.image()` bag `ai.image`, live-målt, udgivet.

## Acceptance criteria
1. Live: `ai.image({ prompt, override:{provider:'mistral', model:'mistral-small-2603'} })` giver en URL der kan hentes som billede, `usage.region === 'eu'`.
2. Unit-test med indsprøjtet fetch: request-body (model, tools, store:false), URL læst fra `tool.execution`, usage med tokens + billedpris og `costBasis 'estimated'`.
3. Unit-test: ikke-understøttede felter kaster med bfl-hint; manglende værktøjsresultat kaster.
4. Unit-test: virker gennem `createAI({ byok:true, providers:{ mistral: byokAdapter(mistralAdapter,{apiKey}) } })`.
5. Ny version på npm; jam og components informeret.

## Dependencies
None.

## Rollout
Additivt, minor. Standard-billedrute uændret.

## Open Questions
1. Mistrals officielle pris pr. billede — bekræftes i Mistral-konsollens forbrug eller ved næste /model-research; indtil da `estimated`.

## Effort estimate
**S** — ½ dag.
