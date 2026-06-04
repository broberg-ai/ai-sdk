# F016 — Mistral Specialty Capabilities (Batch / OCR / Voxtral / Moderation)

> Four new SDK capabilities that the "all AI through @broberg/ai-sdk" rule requires before FysioDK Aalborg (and LHD) can run their full Mistral workloads: batch processing (50% discount), document OCR, Voxtral audio (transcribe + TTS), and content moderation. Tier: capabilities. Effort: L. Status: planned — FysioDK starts ~week of 2026-06-08, so these are build-ready straight away.

## Motivation

F015 added Mistral as a chat provider. But Mistral's value for FysioDK/LHD (per Christian's 2026-06-04 CD assessment, [[mistral-is-gdpr-provider]]) leans heavily on four specialty surfaces the SDK does **not** yet expose. Because the standing rule forbids hand-rolling provider calls outside the SDK, FysioDK can't use any of them until the SDK speaks them:

- **Batch (50% discount)** — nightly summaries, embedding generation, bulk classification. Half-price is material at FysioDK/LHD volume.
- **OCR** — food-label photos, journals, intake forms → structured text. Mistral OCR is per-page and EU-hosted (GDPR-safe for patient documents).
- **Voxtral audio** — voice notes → text, and TTS for coach voice broadcast. Voice-first is a stated product differentiator.
- **Moderation** — screen client notes before they hit the DB. $0.10/M is a trivial compliance uplift.

All four keep client/personal data inside Mistral's EU hosting — the whole point of choosing Mistral.

## Solution

Each is a new capability on the `AiClient` facade, following the existing `runCapability` pattern (input schema → tier/override resolve → provider method → `Usage` stamped → `CostSink`), plus a matching optional method on `ProviderAdapter`. Only the Mistral adapter implements them now; the surface stays provider-agnostic so OpenAI (batch/moderation) can join later. New cost models are added where tokens don't apply (per-page, per-1k-char, per-minute, ×0.5 batch multiplier).

## Scope

### In scope
- `ai.batch.*`, `ai.ocr()`, `ai.transcribe()` (extended to Mistral) + `ai.tts()`, `ai.moderate()` on the facade (`src/client.ts`, `src/schema/inputs.ts`).
- Mistral adapter methods in `src/providers/mistral.ts` (or a `mistral-*.ts` split if the file grows): `batch*`, `ocr`, `transcribe`, `tts`, `moderate`.
- New capability modules under `src/capabilities/` (`ocr.ts`, `tts.ts`, `moderate.ts`, `batch.ts`); `transcribe.ts` extended.
- Cost: per-page (OCR), per-1k-char (TTS), per-minute (transcribe — exists), per-token (moderation, via `pricing.ts`), and a 0.5 batch multiplier on `Usage`.
- Tests (offline, injected fetch) per capability + one live smoke per capability against the real Mistral key before each story closes.

### Out of scope
- The **application** wiring (FysioDK/LHD tier-router, per-module model picks, the nightly-batch job, voice-note flow). That lives in the product repos — the SDK only provides the capabilities. ([[ai-sdk-is-the-ai-standard]]: SDK = per-turn engine, caller owns orchestration.)
- Mistral's Agent-API tools (code execution, web search, Libraries/RAG, image-gen, premium news). Separate future scope.
- OpenAI/other-provider implementations of these capabilities — surface is built provider-agnostic, but only Mistral is wired now.
- Fine-tunable Classifier API (training + storage billing) — moderation uses the off-the-shelf `mistral-moderation-latest`.

## Architecture

### F016.1 — Batch (`ai.batch`)
A sub-surface like `ai.contracts.*`. Mistral batch is async (results within 24h at 50% cost):
- `ai.batch.submit({ requests: BatchRequest[], capability?, override? }) → { jobId }` — uploads a JSONL via `POST /v1/files` (purpose `batch`), then `POST /v1/batch/jobs` `{input_files, model, endpoint:"/v1/chat/completions"}`.
- `ai.batch.status(jobId) → { status, completed, total, ... }` — `GET /v1/batch/jobs/{id}`.
- `ai.batch.results(jobId) → { results: {customId, output, usage}[] }` — downloads the output file; each row's `Usage.costUsd` = normal `computeCost × 0.5`, stamped `batch:true`.
- `ProviderAdapter.batch?` (submit/status/results). Mistral only.

### F016.2 — OCR (`ai.ocr`)
- `ai.ocr({ document: string|Uint8Array, mimeType?, model?, override? }) → { pages: {index, markdown}[], usage }`.
- Mistral: `POST /v1/ocr` `{model:"mistral-ocr-latest", document:{type:"document_url"|"image_url", ...}}` → `{pages:[{index, markdown, ...}], usage_info:{pages_processed}}`.
- Cost: **per page** (like the Gemini per-image model). `mistral-ocr` = $2 / 1000 pages = $0.002/page; `usage.costUsd = pagesProcessed × pricePerPage` (adapter map, overridable).
- `ProviderAdapter.ocr?`.

### F016.3 — Voxtral audio (`ai.transcribe` extended + `ai.tts`)
- **Transcribe**: route existing `ai.transcribe()` to Mistral. `POST /v1/audio/transcriptions` (OpenAI-compatible multipart), model `voxtral-mini-transcribe`. Cost **per minute** ($0.002/min) — the transcribe cost path is already per-minute (F5.6).
- **TTS (new)**: `ai.tts({ text, voice?, model?, override? }) → { audio: Uint8Array, mimeType, usage }`. Mistral TTS (`voxtral-tts`); cost **per 1k characters** ($0.016/1k). New `ProviderAdapter.tts?` + `src/capabilities/tts.ts`.

### F016.4 — Moderation (`ai.moderate`)
- `ai.moderate({ input: string|string[], model?, override? }) → { results: {flagged, categories, categoryScores}[], usage }`.
- Mistral: `POST /v1/moderations` `{model:"mistral-moderation-latest", input}` → `{results:[{categories:{...9...}, category_scores}]}`. `flagged` = any category true.
- Cost: per-token input, `mistral:mistral-moderation-latest` = $0.10/M / $0 (already addable to `pricing.ts`).
- `ProviderAdapter.moderate?`.

## Stories
- **F016.1** — Batch API surface (`ai.batch.submit/status/results`) over Mistral's files + batch-jobs endpoints; 0.5 cost multiplier; offline tests + live smoke.
- **F016.2** — `ai.ocr()` over `mistral-ocr`; per-page cost; offline tests + live smoke on a real document/image.
- **F016.3** — Voxtral audio: extend `ai.transcribe()` to `voxtral-mini-transcribe` (per-min) + new `ai.tts()` over `voxtral-tts` (per-1k-char); offline tests + live smoke.
- **F016.4** — `ai.moderate()` over `mistral-moderation-latest`; per-token cost; offline tests + live smoke.

## Acceptance criteria
1. Each capability is callable from `createAI()` (`ai.batch.*`, `ai.ocr`, `ai.tts`, `ai.moderate`, `ai.transcribe` w/ Mistral override) and returns the documented shape.
2. Every call stamps a correct non-zero `Usage.costUsd` via its cost model (batch ×0.5, OCR per-page, TTS per-1k-char, transcribe per-min, moderation per-token) — no $0 under-count.
3. Each capability has offline tests (injected fetch, no live network) AND one live smoke verified against the real Mistral key before its story closes — proof, not assertion.
4. The Mistral adapter methods are optional on `ProviderAdapter` so non-Mistral providers compile unchanged; typecheck clean, full suite green.
5. `docs/API.md` documents each new capability with a usage snippet.

## Dependencies
- F015 (Mistral adapter + `MISTRAL_API_KEY` in env) — done.
- Existing `runCapability` + `CostSink` + `freshUsage` plumbing (`src/client.ts`, `src/cost/usage.ts`) — reused.
- Endpoint/shape confirmation against docs.mistral.ai for: batch jobs flow, OCR response, **TTS endpoint + voice params** (least certain), moderation response. See Open Questions.

## Rollout
Phased, each story independently shippable + published. Suggested order by FysioDK need:
1. **F016.2 OCR** + **F016.4 Moderation** first — they gate patient-document handling + the "moderate before DB" compliance path FysioDK needs at launch.
2. **F016.1 Batch** next — nightly summaries/embeddings (a cost optimization, not launch-blocking).
3. **F016.3 Voxtral** last — voice is a differentiator but not week-1 critical.
Each lands on main and ships in the rolling v0.5.x/v0.6.0 line (bundles with the pending pricing fixes). Rollback = a capability is inert unless called; remove the adapter method to disable.

## Open Questions
- **TTS endpoint + params** — confirm Mistral's TTS route (`/v1/audio/speech`?), model id (`voxtral-tts`?), and voice/voice-clone params against docs.mistral.ai before building F016.3's TTS half.
- **Batch endpoint shape** — confirm the files-upload purpose + batch-jobs request/response (input_files vs input_file, output retrieval) against current docs.
- **Moderation route** — `/v1/moderations` vs `/v1/chat/moderations`; confirm the 9-category response keys.
- Do we want `ai.transcribe`/`ai.moderate`/`ai.ocr` to be provider-agnostic from day 1 (OpenAI also offers moderation + transcription), or Mistral-only until a second consumer asks? Plan assumes provider-agnostic surface, Mistral-only impl.

## Effort estimate
**L** — ~3–5 days across the four stories. F016.2 (OCR) + F016.4 (moderation) are ~0.5 day each (single request/response). F016.1 (batch, async job lifecycle) ~1.5 days. F016.3 (transcribe + TTS, two APIs + audio bytes) ~1.5 days.
