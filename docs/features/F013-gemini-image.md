# F013 — Gemini image generation adapter

> Status: planned · Epic · Priority: high · Ships 0.5.0
> Surfaced by cms migration KAT 5 (F6.4). cms-core chose option (b): extend the SDK.

## Motivation

cms generates images via **Gemini** directly (`gemini-3-pro-image-preview` / nano-banana, `generativelanguage:generateContent` with image output) — a deliberate choice, distinct output from fal/flux. `ai.image()` only had a **fal** adapter, so cms's image call-site couldn't migrate without switching providers. Standing policy: extend the SDK rather than force a provider switch. So we add a Gemini image provider.

## Scope

Add `image()` to the gemini adapter (so `ai.image({ override:{ provider:"gemini", model:"gemini-3-pro-image-preview", transport:"http" } })` works):

- POST `{baseUrl}/models/{model}:generateContent?key=` with `{ contents:[{role:"user",parts:[{text:prompt}]}], generationConfig:{ responseModalities:["TEXT","IMAGE"] } }`.
- Parse the first inline image part — handle BOTH `inlineData{mimeType,data}` (camel) and `inline_data{mime_type,data}` (snake alias seen on some responses).
- Honor `promptFeedback.blockReason` → throw a clear error.
- Return the image as a **`data:<mime>;base64,...` URL** in `ImageResult{url, usage}` (Gemini returns inline bytes, not a hosted URL like fal; the consumer slices the prefix for raw bytes).
- Cost: per-image flat for the known nano-banana models (`gemini-3-pro-image-preview`, `gemini-2.5-flash-image` = $0.039) + a `config.pricePerImage` override. usage tokens from usageMetadata.

### Built against cms's exact request

Mirrors `packages/cms-admin/src/lib/ai/image-generation.ts` (read directly). Prod call-site (`lib/tools/image-generation.ts` → `generateImage({prompt})`) is prompt→image only; reference-image editing exists in the lib but is test-only — OUT of scope for v1.

### Non-goals

- No reference-image / edit input (test-only in cms; not in the prod path). Could be a follow-up if a real consumer needs it.
- No width/height control (Gemini generateContent is prompt-driven; the fields are ignored for gemini).
- Default image route stays fal — gemini image is opt-in via override.

## Stories

| # | Title | Gist |
|---|---|---|
| F13.1 | gemini adapter image() + per-image cost | generateContent image POST + inline base64 → data URL + $0.039/image + tests; publish 0.5.0 |

## Rollout

Publish 0.5.0 → cms swaps its last call-site (`lib/ai/image-generation.ts`) to `ai.image({override:{provider:"gemini",...}})` → F6.4 fully done. cms-core live-verifies (they have the Gemini key; ai-sdk has none locally so the adapter is unit-tested against the documented wire shape).
