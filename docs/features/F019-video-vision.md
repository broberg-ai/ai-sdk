# F019 — Video Vision (`ai.video()`)

> A new SDK capability to analyze a video (e.g. "what's in the first 30 seconds?") through any native-video model. The inventory (F017) shows 44 models accept video input; the SDK only does images today. Adds a `video` content part + `ai.video()`, wired for Gemini (native) + OpenRouter video models. Tier: capabilities. Effort: M. Status: planned — build straight away, live-test with gemini-2.5-flash-lite on a real clip.

## Motivation

Christian needs to feed a video clip to a model and get back "what does this contain?" (content tagging, moderation pre-screen, summarization). The F017 inventory shows this is well-supported — 44 models take native video input (Gemini leads; gemma-4 + nvidia-nemotron are free dev options) — but the SDK's vision capability only accepts **images**. Without `ai.video()`, any video analysis would be hand-rolled outside the SDK, which the standing rule forbids.

## Solution

Add a `video` variant to `ContentPart`, and an `ai.video({video, prompt, override})` convenience capability (chat under the hood with a single video part). Teach the Gemini adapter to send video inline (base64 `inlineData`, or the Files API for clips >~20MB) and the OpenAI-compatible adapter to send the OpenRouter video-content form. Cost is token-based (Gemini/OpenRouter bill video as tokens via `usageMetadata`/`usage`) — the existing `computeCost` path applies.

## Scope

### In scope
- `ContentPart` gains a `video` variant (`src/types.ts` + `src/schema/inputs.ts`): `{ type:"video", video: string|Uint8Array, mimeType? }` (URL, data-URL, or raw bytes).
- `ai.video({ video, prompt, override?, tier? })` capability (`src/capabilities/video.ts`) — single-turn convenience over chat; returns `{ text, usage }`.
- A `video` tier in `DEFAULT_TIER_MAP` → `gemini` / `gemini-2.5-flash-lite` (cheap native video) so `ai.video()` works without an override.
- Gemini adapter: `partsFrom` handles a video part (inline base64; Files-API fallback for large clips). `src/providers/gemini.ts`.
- OpenAI-compatible adapter: emit the OpenRouter video-content part so gemma-4 / nvidia-nemotron / other OR video models work. `src/providers/openai-compatible.ts`.
- Tests: offline (injected fetch) for both adapter paths + the capability; one **live** smoke with `gemini-2.5-flash-lite` on a real ~30s clip.

### Out of scope
- Client-side frame extraction (the "sample N frames → image vision" alternative). `ai.video()` is native-video; frame-sampling stays the caller's choice via `ai.vision()`.
- Audio-track transcription of the video (that's Voxtral / F016.3).
- A GDPR-safe native-video path — none exists (no EU vendor does native video; the inventory confirms US/CN only). For personal-data video the documented route stays: extract frames locally → Mistral vision (EU). Noted, not built here.
- Streaming video analysis / real-time.

## Architecture

### `ContentPart` video variant — `src/types.ts`
```ts
| { type: "video"; video: string | Uint8Array; mimeType?: string }
```
Mirrors the existing image part. `mimeType` defaults to `video/mp4`.

### `ai.video()` — `src/capabilities/video.ts`
```ts
ai.video({ video: string | Uint8Array, prompt: string, mimeType?, override?, tier? })
  → { text: string; usage: Usage }
```
Builds a one-message chat: `[{ role:"user", content:[{type:"video", …}, {type:"text", text: prompt}] }]`, routes via tier `video` (default) or `override`, returns the model's text. `purpose`/`labels` supported like other caps.

### Gemini adapter — `partsFrom` video branch
Inline: `{ inlineData: { mimeType, data: <base64> } }` (same shape as images; Gemini accepts video mime types natively). For clips over the inline limit (~20MB), upload via the Files API (`POST /upload/v1beta/files`) and reference by `fileData.fileUri`. MVP = inline; Files-API fallback flagged.

### OpenAI-compatible adapter — OpenRouter video part
OpenRouter video models take a content part of the form OpenRouter documents for video (e.g. `{ type:"video_url", video_url:{ url } }` or a file part) — confirm exact shape against OpenRouter docs in F019.3. Maps from the SDK `video` part.

### Cost
Token-based — `usageMetadata.promptTokenCount` (Gemini counts video as tokens) / OpenRouter `usage` → `computeCost(provider, model, …)`. No new cost model needed.

## Stories
- **F019.1** — `video` ContentPart + schema + `ai.video()` capability + a `video` tier (gemini-2.5-flash-lite default). Offline test of the capability shape.
- **F019.2** — Gemini adapter video input (inline base64; Files-API fallback noted). **Live test: `gemini-2.5-flash-lite` on the real ~30s clip (from Christian's Downloads)** → returns a sensible "what's in it" description; cost non-zero.
- **F019.3** — OpenAI-compatible adapter video input for OpenRouter models (gemma-4, nvidia-nemotron). Offline test; live test needs an `OPENROUTER_API_KEY` (free-tier models still require an OR key).

## Acceptance criteria
1. `ai.video({ video, prompt, override:{provider:"gemini", model:"gemini-2.5-flash-lite", transport:"http"} })` returns a text description of a real video from a live call.
2. `usage.costUsd` is non-zero (token-based, no $0 under-count).
3. The OpenRouter path compiles + has an offline test for gemma-4 / nvidia-nemotron; live-verified once an `OPENROUTER_API_KEY` is available.
4. `ai.video()` works without an override via the default `video` tier.
5. Offline tests + typecheck clean + full suite green; documented in `docs/API.md`.

## Dependencies
- F017 inventory (confirms which models take video — gemma-4, nvidia-nemotron, gemini-2.5-flash-lite).
- Existing `gemini` + `openai-compatible` adapters, `runCapability`, `computeCost` — reused.
- A real ~30s clip in Christian's `~/Downloads` for the live test.
- `OPENROUTER_API_KEY` (optional) for the gemma-4 / nvidia-nemotron live tests; `gemini-2.5-flash-lite` works with the existing `GEMINI_API_KEY`.

## Rollout
Single-phase, additive — a new content-part variant + capability; nothing existing changes. Ships in the rolling v0.5.x/v0.6.0 line. Rollback = the capability is inert unless called.

## Open Questions
- **OpenRouter video-content shape** — confirm the exact part form (`video_url` vs file) against OpenRouter docs before F019.3.
- **Large clips** — inline base64 (≤~20MB) vs Gemini Files API. MVP inline; add Files-API when a real clip exceeds the limit.

## Effort estimate
**M** — ~1.5 days. F019.1 (~0.5d types+capability), F019.2 (~0.5d Gemini + live test), F019.3 (~0.5d OpenRouter path).
