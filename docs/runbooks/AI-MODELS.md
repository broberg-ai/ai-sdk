# AI Models Runbook — what to use for what

> The menu of models reachable through `@broberg/ai-sdk`, organised by **purpose**
> then **provider**. Prices are USD per 1M tokens (input / output) unless noted;
> ✅ = in the SDK pricing table (`src/cost/pricing.ts`, so `usage.costUsd` is
> metered automatically), ⚠️ = reachable but verify the live price/slug before
> relying on cost. Image/audio models are priced per-image / per-minute, not per
> token. Last reviewed: 2026-06-02.

How a model is selected in the SDK: a **tier** (`fast/smart/powerful/cheap/vision/
embedding`) resolves to a `(provider, model, transport)` triple, overridable per
call via `override: { provider, model, transport }`. OpenRouter reaches anything
by slug; DeepInfra serves open-weights cheaply via an OpenAI-compatible API.

---

## 1. Chat / reasoning — text in, text out

| Purpose | Provider | Model | Price in/out | SDK tier |
|---|---|---|---|---|
| **Hardest reasoning** | Anthropic | `claude-opus-4-8` | 15 / 75 ✅ | `powerful` |
| **Balanced default** | Anthropic | `claude-sonnet-4-6` | 3 / 15 ✅ | `smart` |
| **Fast / cheap** | Anthropic | `claude-haiku-4-5` | 0.8 / 4 ✅ | `fast` |
| **Free (Max plan)** | Anthropic | `claude-haiku-4-5` via `claude -p` subprocess | **0** (subprocess) ✅ | `cheap` |
| Flagship multimodal | OpenAI | `gpt-4o` | 2.5 / 10 ✅ | override |
| Cheap general | OpenAI | `gpt-4o-mini` | 0.15 / 0.6 ✅ | override |
| Fast multimodal | Google | `gemini-2.5-flash` | 0.30 / 2.50 ✅ | override |
| Capable | Google | `gemini-2.5-pro` | ⚠️ verify | override |
| Lite / cheapest Gemini | Google (OpenRouter) | `google/gemini-2.0-flash-lite-001` | 0.07 / 0.30 ⚠️ | override |
| Cost-router incl. all above | OpenRouter | `anthropic/claude-…`, `google/gemini-…` | mirrors upstream ✅ for sonnet/haiku/flash | override |
| Frontier open | OpenRouter | `minimax/minimax-m2.7` | 0.30 / 1.20 ⚠️ (estimate) | override |
| Open reasoning | OpenRouter | `deepseek/deepseek-r1`, `z-ai/glm-4.6`, `qwen/qwen3-…` | ⚠️ verify | override |
| Open-weights, cheap | DeepInfra | `meta-llama/Llama-3.3-70B-Instruct`, `Qwen/Qwen2.5-72B-Instruct` | ⚠️ verify | override |

## 2. Vision — image + text in, text out

| Purpose | Provider | Model | Notes | SDK tier |
|---|---|---|---|---|
| **Default vision** | Anthropic | `claude-sonnet-4-6` | image blocks (url or base64); used by xrt81 pilot | `vision` |
| Cheaper vision | Anthropic | `claude-haiku-4-5` | image blocks | override |
| Multimodal | OpenAI | `gpt-4o` | `image_url` parts | override |
| Fast vision | Google | `gemini-2.5-flash` | inlineData base64 | override |

`ai.vision({ image, mimeType, prompt })` — pass a URL string or raw `Uint8Array`
(adapter base64-encodes).

## 3. Image generation — prompt in, image URL out (`ai.image`)

| Purpose | Provider | Model | Notes |
|---|---|---|---|
| **Fast / cheap (default)** | fal.ai | `fal-ai/flux/schnell` | sync `fal.run`; ~1–2s; used by sanneandersen |
| Higher quality | fal.ai | `fal-ai/flux/dev` | queue mode; slower |
| Pro | fal.ai | `fal-ai/flux-pro` / `fal-ai/flux-pro/v1.1` | ⚠️ verify |
| Design/vector-ish | fal.ai | `fal-ai/recraft-v3` | ⚠️ verify |
| SDXL family | fal.ai | `fal-ai/fast-sdxl` | ⚠️ verify |
| Text-rendering images | Google | `gemini-3-pro-image-preview`, `gemini-2.5-flash-image` | cms uses these (separate REST path) |

> fal/Gemini image cost is per-image, not per-token. See §7 (limitations) for SDK
> cost handling.

## 4. Embeddings — text in, vector out (`ai.embedding`)

| Purpose | Provider | Model | Price | SDK tier |
|---|---|---|---|---|
| **Default, cheap** | OpenAI | `text-embedding-3-small` | 0.02 / – ✅ | `embedding` |
| Higher quality | OpenAI | `text-embedding-3-large` | 0.13 / – ✅ | override |
| Open / self-host-ish | DeepInfra | `BAAI/bge-m3`, `BAAI/bge-large-en-v1.5` | ⚠️ verify | override |

## 5. Transcription — audio in, text out (`ai.transcribe`)

| Purpose | Provider | Model | Price | Notes |
|---|---|---|---|---|
| **Default** | OpenAI | `whisper-1` | $0.006 / min | multipart upload; Danish OK |
| Newer / cheaper | OpenAI | `gpt-4o-mini-transcribe`, `gpt-4o-transcribe` | ⚠️ verify | override model |

## 6. Prompt-contract capabilities (`ai.contracts.*`)

These pick a sensible default tier but run on the chat/vision models above:

| Contract | Default tier | Typical model |
|---|---|---|
| `mockup` (→ HTML) | `smart` | claude-sonnet-4-6 |
| `design` (vision → HTML) | `powerful` | claude-opus-4-8 |
| `extract` (→ Zod-validated JSON) | `smart` | claude-sonnet-4-6 |
| `classify` (→ label) | `cheap` | claude-haiku-4-5 (subprocess) |
| `rerank` (→ scored) | `fast` | claude-haiku-4-5 |

---

## 7. Choosing — quick heuristics

- **Default to `smart`** (sonnet) for chat; drop to `fast`/`cheap` for bulk/simple,
  raise to `powerful` (opus) only for the hardest tasks.
- **Free quota?** Use `cheap` (subprocess `claude -p`) on the Max plan — `costUsd 0`,
  tokens still tracked.
- **Need a specific non-Anthropic model?** Reach it via OpenRouter by slug
  (`override: { provider:"openrouter", model:"<slug>", transport:"http" }`) — one
  key, every vendor.
- **Cost-sensitive bulk open-weights?** DeepInfra.
- **Vision** → sonnet (default) or gpt-4o / gemini-flash. **Images** → fal flux/schnell.
  **Embeddings** → text-embedding-3-small. **Audio** → whisper-1.

> Keep this list current: when a provider ships a new model worth using, add the
> row + (if you want metered cost) a pricing entry in `src/cost/pricing.ts`.
