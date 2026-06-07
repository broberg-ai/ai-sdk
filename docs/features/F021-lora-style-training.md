# F021 — LoRA Style Training (ai.trainStyle + ai.image loras)

> Train a reusable brand/style LoRA from a set of images via fal.ai, then generate new images that hit that style every time. Tier: capability. Effort: M. Status: building.

## Motivation
sa (sanneandersen) has 8 clean line-art treatment illustrations and wants newsletter images that hit Sanne's brand style **every time** — today prompt-steered `flux/schnell` varies run-to-run. The fix is a trained **style LoRA**: train once on the 8 images → get a LoRA → generate in that exact style. This is API-based at fal, and per the standing "all AI through the SDK" rule it belongs in the facade as a **reusable** capability, not a one-off script — other repos (cms, FysioDK, CPM) will want brand-LoRAs too.

## Solution
Add `ai.trainStyle({ images, isStyle, triggerWord?, steps? }) → { loraUrl, configUrl, usage }` backed by fal `fal-ai/flux-lora-fast-training`, and extend `ai.image` with a `loras` array (and a `lora` shorthand) backed by `fal-ai/flux-lora` for inference. The SDK handles the fal "training images must be a zip on a fetchable URL" gotcha internally: an array of image URLs is fetched, zipped in-memory (node:zlib, zero new deps), and passed as a `data:` URI; a single string is treated as an already-hosted archive URL (passthrough).

## Scope

### In scope
- `src/types.ts`: `TrainStyleRequest`, `TrainStyleResult`, `LoraWeight`; extend `ImageRequest` with `loras?: LoraWeight[]`; `Capability` += `"trainStyle"`; `ProviderAdapter.trainStyle?`.
- `src/schema/inputs.ts`: `trainStyleInputSchema`; extend `imageInputSchema` with `loras?` + `lora?` shorthand; `TrainStyleInput` type; `AiClient.trainStyle`.
- `src/client.ts`: `DEFAULT_TRAINSTYLE_SPEC` (fal-ai/flux-lora-fast-training) + `DEFAULT_LORA_IMAGE_SPEC` (fal-ai/flux-lora); `trainStyle()` method; route `image()` to the LoRA model when `loras`/`lora` present (unless overridden) and pass `loras` to the adapter.
- `src/providers/fal.ts`: `trainStyle()` (zip-build → queue submit → poll w/ long deadline → map `diffusers_lora_file.url` + `config_file.url`); extend `image()` to forward `loras`; in-memory zip builder (node:zlib deflate + crc32); read `FAL_KEY ?? FAL_API_KEY` (sa's stated gotcha); training cost estimate (~$2, override via config).
- `src/index.ts`: export new types.
- Tests (`src/providers/fal-lora.test.ts`): zip round-trips (inflate back to identical bytes), trainStyle string[]→data-uri-zip request shape, trainStyle string→passthrough, image+loras routes to flux-lora with correct body, lora shorthand normalizes.
- `docs/API.md`: capabilities-table row + usage section + version footer.

### Out of scope
- Live training run / pilot — done by sa (this session has no `FAL_KEY`; ship offline-verified, sa pilots the $2 live train, same pattern as F016.1 batch).
- fal storage upload via fal's alpha REST (avoided by the data-URI approach; revisit only if data-URI size limits bite on large training sets).
- LoRA management/registry (storing/naming trained LoRAs) — caller owns the returned `loraUrl`.
- Non-fal LoRA backends.

## Architecture

### `ai.trainStyle`
```ts
trainStyle(input: {
  images: string | string[];   // hosted archive URL | array of image URLs (SDK zips them)
  isStyle?: boolean;           // default true (style LoRA — disables captioning/masks)
  triggerWord?: string;
  steps?: number;              // ~1000 typical
  createMasks?: boolean;
} & CallOptions): Promise<{ loraUrl: string; configUrl: string; usage: Usage }>
```
Default route `{ provider:"fal", model:"fal-ai/flux-lora-fast-training", transport:"http" }`. fal queue API: submit → poll `status_url` until COMPLETED → fetch `response_url` → map `diffusers_lora_file.url`→`loraUrl`, `config_file.url`→`configUrl`. Long deadline (~10 min) since training takes minutes. Cost: flat ~$2 estimate on `usage.costUsd` (fal returns no price).

### `ai.image` with LoRAs
`image({ prompt, loras:[{ path, scale? }] })` or shorthand `image({ prompt, lora: loraUrl })`. When present and no model override, route to `fal-ai/flux-lora`; body carries `loras:[{path,scale}]`. Output unchanged (`{ url, usage }`).

### In-memory zip (no new deps)
`node:zlib` `deflateRawSync` + `crc32` (both present in Bun) → spec-compliant ZIP (local headers + central dir + EOCD). For `images: string[]`: fetch each → zip → `data:application/zip;base64,…` as `images_data_url`. Documented limit: very large sets → pre-host a zip and pass the URL.

## Stories
- **F021.1** — types + schema + facade (`trainStyle`, `image` loras + shorthand).
- **F021.2** — fal adapter: `trainStyle` (zip-build + queue + map) + `image` loras forwarding + `FAL_KEY ?? FAL_API_KEY`.
- **F021.3** — offline tests (zip round-trip, request shapes) + docs + version bump + export.

## Acceptance criteria
1. `ai.trainStyle({ images: string[] })` builds a valid zip (inflates back to identical input bytes — offline test) and submits it as `images_data_url` to `fal-ai/flux-lora-fast-training` with `is_style`/`trigger_word`/`steps`; returns `{ loraUrl, configUrl, usage }` with non-zero `usage.costUsd`.
2. `ai.trainStyle({ images: "<zipUrl>" })` passes the URL straight through as `images_data_url` (no zipping).
3. `ai.image({ prompt, loras:[{path,scale}] })` routes to `fal-ai/flux-lora` and sends `loras` in the body; `lora` shorthand normalizes to one-element `loras`.
4. fal adapter resolves the key from `FAL_KEY ?? FAL_API_KEY`.
5. typecheck clean + full suite green; docs/API.md documents both.

## Dependencies
- F5.3 (existing fal image adapter) — extended here. None blocking.

## Rollout
Single additive minor (v0.10.0) — no breaking changes to `ai.image`. Ship offline-verified; sa runs the live $2 pilot train on the 8 illustrations and reports the resulting `loraUrl`, then swaps newsletter image-gen to `ai.image({ lora })`. Rollback = callers stop passing `loras` (default flux/schnell path untouched).

## Open Questions
None blocking. Watch: data-URI zip size on very large training sets (mitigated by the hosted-zipUrl passthrough).

## Effort estimate
**M** — ~1 day. One adapter method + a small zip writer + facade/schema wiring + offline tests.
