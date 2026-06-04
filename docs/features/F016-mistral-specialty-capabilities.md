# F016 — Mistral Specialty Capabilities (Batch / OCR / Voxtral / Moderation / Embeddings / Classifier)

> Six SDK capabilities that the "all AI through @broberg/ai-sdk" rule requires before FysioDK Aalborg (and LHD) can run their full Mistral workloads: batch processing (50% discount), document OCR, Voxtral audio (transcribe + TTS), content moderation, embeddings, and classification. Tier: capabilities. Effort: L. Status: planned — FysioDK starts ~week of 2026-06-08.

## Motivation

F015 added Mistral as a chat provider. But Mistral's value for FysioDK/LHD (per Christian's 2026-06-04 CD assessment, [[mistral-is-gdpr-provider]]) leans on specialty surfaces the SDK does not yet expose. The standing rule forbids hand-rolling provider calls outside the SDK, so FysioDK can't use any of them until the SDK speaks them:

- **Batch (50% discount)** — nightly summaries, embedding generation, bulk classification.
- **OCR** — food-label photos, journals, intake forms → structured text (EU-hosted, GDPR-safe for patient docs).
- **Voxtral audio** — voice notes → text, and TTS for coach voice broadcast.
- **Moderation** — screen client notes before the DB.
- **Embeddings** — semantic search / RAG over Trail content + client knowledge.
- **Classifier** — topic-tagging client notes; a fine-tunable classification surface.

All keep client/personal data inside Mistral's EU hosting.

## Solution

Each is a capability on the `AiClient` facade following the existing `runCapability` pattern (input schema → tier/override resolve → provider method → `Usage` stamped → `CostSink`), plus a matching optional method on `ProviderAdapter`. Only the Mistral adapter implements them now; the surface stays provider-agnostic. New cost models added where tokens don't apply (per-page, per-1k-char, per-minute, ×0.5 batch). Embeddings reuse the SDK's existing `ai.embedding()` capability — just a Mistral route + price.

## Scope

### In scope
- `ai.batch.*`, `ai.ocr()`, `ai.transcribe()` (extended to Mistral) + `ai.tts()`, `ai.moderate()`, `ai.embedding()` (Mistral route), `ai.classify()` on the facade.
- Mistral adapter methods in `src/providers/mistral.ts`: `batch*`, `ocr`, `transcribe`, `tts`, `moderate`, `embed`, `classify`.
- New capability modules under `src/capabilities/` (`ocr.ts`, `tts.ts`, `moderate.ts`, `batch.ts`, `classify.ts`); `transcribe.ts` + `embedding.ts` extended.
- Cost: per-page (OCR), per-1k-char (TTS), per-minute (transcribe), per-token (moderation/embeddings/classifier via `pricing.ts`), and a 0.5 batch multiplier.
- Tests (offline, injected fetch) per capability + one live smoke per capability against the real Mistral key.

### Out of scope
- The application wiring (FysioDK/LHD tier-router, nightly-batch job, voice flow). Lives in the product repos.
- Mistral's Agent-API tools (code execution, web search, Libraries/RAG, image-gen, premium news). Separate future scope.
- OpenAI/other-provider implementations — surface is provider-agnostic, only Mistral is wired now.

## Architecture

### F016.1 — Batch (`ai.batch`)
Async sub-surface: `submit({requests, capability?, override?}) → {jobId}` (upload JSONL via `POST /v1/files` purpose `batch`, then `POST /v1/batch/jobs`), `status(jobId)`, `results(jobId)` (download output; each row `costUsd = computeCost × 0.5`, stamped `batch:true`). `ProviderAdapter.batch?`.

### F016.2 — OCR (`ai.ocr`)
`POST /v1/ocr` `{model:"mistral-ocr-latest", document:{type, …}}` → `{pages:[{index, markdown}], usage_info:{pages_processed}}`. Per-page cost ($0.002/page). `ProviderAdapter.ocr?`.

### F016.3 — Voxtral (`ai.transcribe` extended + `ai.tts`)
Transcribe → `POST /v1/audio/transcriptions` (`voxtral-mini-transcribe`, per-min). TTS (new) → `ai.tts({text, voice?}) → {audio, mimeType, usage}` (`voxtral-tts`, per-1k-char). `ProviderAdapter.tts?`.

### F016.4 — Moderation (`ai.moderate`)
`POST /v1/moderations` `{model:"mistral-moderation-latest", input}` → `{results:[{flagged, categories, categoryScores}]}`. Per-token ($0.10/M). `ProviderAdapter.moderate?`.

### F016.5 — Embeddings (`ai.embedding` → Mistral)
Route the **existing** `ai.embedding()` capability to Mistral: `ProviderAdapter.embed` → `POST /v1/embeddings` (`mistral-embed` / `codestral-embed`, OpenAI-compatible) → `number[][]`. Pricing `mistral:mistral-embed` $0.10/M input. The capability + cost plumbing already exist — just the Mistral route + price.

### F016.6 — Classifier (`ai.classify`)
Expose Mistral's classifier API: `ai.classify({input, model?, override?}) → {labels/scores, usage}` + `ProviderAdapter.classify?`. Off-the-shelf classifier (and optionally a fine-tuned Classifier-API model id). Per-token. NB the SDK already has a prompt-based `ai.contracts.classify` — decide whether to unify or keep the dedicated Mistral endpoint separate.

## Stories
- **F016.1** — Batch API surface (50% cost). 
- **F016.2** — `ai.ocr()` (per-page).
- **F016.3** — Voxtral transcribe (per-min) + new `ai.tts()` (per-1k-char).
- **F016.4** — `ai.moderate()` (per-token).
- **F016.5** — Mistral embeddings via the existing `ai.embedding()` (per-token).
- **F016.6** — `ai.classify()` over Mistral's classifier (per-token).

## Acceptance criteria
1. Each capability is callable from `createAI()` and returns the documented shape.
2. Every call stamps a correct non-zero `Usage.costUsd` via its cost model — no $0 under-count.
3. Each capability has offline tests + one live smoke against the real Mistral key before its story closes — proof, not assertion.
4. Mistral adapter methods are optional on `ProviderAdapter`; non-Mistral providers compile unchanged; typecheck clean, suite green.
5. `docs/API.md` documents each new capability.

## Dependencies
- F015 (Mistral adapter + `MISTRAL_API_KEY`) — done.
- Existing `runCapability` + `CostSink` + `freshUsage` + `ai.embedding()` plumbing — reused.
- Endpoint/shape confirmation against docs.mistral.ai (esp. TTS, batch, classifier).

## Rollout
Phased, each story independently shippable + published. Order by FysioDK need:
1. **F016.2 OCR** + **F016.4 Moderation** first — patient-document handling + moderate-before-DB at launch.
2. **F016.5 Embeddings** + **F016.1 Batch** — RAG + nightly cost optimization.
3. **F016.3 Voxtral** + **F016.6 Classifier** — voice + topic-tagging, post-launch.
Each lands on main + ships in the rolling v0.5.x/v0.6.0 line. Rollback = a capability is inert unless called.

## Open Questions
- **TTS endpoint + params** — confirm route/model/voice params vs docs.mistral.ai before F016.3 TTS.
- **Batch endpoint shape** — confirm files-upload purpose + job request/response.
- **Moderation route** — `/v1/moderations` vs `/v1/chat/moderations`.
- **Classifier vs `ai.contracts.classify`** — unify, or keep the dedicated Mistral classifier endpoint separate?

## Effort estimate
**L** — ~4–6 days across six stories. OCR/moderation/embeddings ~0.5d each; batch + voxtral ~1.5d each; classifier ~0.75d.
