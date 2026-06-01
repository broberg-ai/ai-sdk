# AI/LLM Usage Inventory

> Produced by F1 cc-traversal (read-only) over the actual **source code** of all
> repos with live AI usage. Every call-site below cites a real `file:line` from
> `.ts`/`.tsx` code — `.md`/docs were excluded from findings. Scan date: 2026-06-02.
> Excluded dirs: `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`, lockfiles.

## 1. Summary table

| Repo | Live call-site files | Providers | Capabilities | Tracks cost? | Transports |
|---|---|---|---|---|---|
| **cms** (`@webhouse/cms`) | ~26 | Anthropic SDK, OpenAI SDK, Google Gemini (REST) | chat/orchestration, content, seo, image-gen, classify/extract | **Yes** (per-provider PRICING + `budget/tracker.ts`) | HTTP (SDK + REST) |
| **trail** (`@trail/root`) | ~23 | Anthropic API (raw fetch), OpenRouter, OpenAI (Whisper), claude-cli | chat, translate, vision, transcribe, extract, classify | **Yes** (`cost-aggregator.ts`, `credits.ts`, model-lab `cost_usd`) | HTTP + **subprocess** (`claude -p` / claude-cli) + OpenRouter |
| **buddy** (`@webhouse/buddy`) | ~10 | Anthropic via `claude -p` (primary); OpenRouter planned (F44) | code-review (chat) | **Yes** (parses `usage` + `total_cost_usd` from CLI JSON) | **subprocess** (`claude -p --output-format json`) |
| **sanneandersen** (`@webhouse/sanneandersen`) | ~5 | OpenRouter (Gemini primary, Claude fallback), fal.ai | chat (Eir), image, translate/voice, auto-title | **No** (no `costUsd` in lib) | HTTP (fetch → openrouter.ai + fal.run) |
| **xrt81** (`xrt81`) | ~3 | Anthropic direct (raw fetch), OpenRouter fallback | vision, extract (text gen) | **No** | HTTP (raw fetch, no SDK) |

**Provider matrix (locked against real code):** Anthropic (SDK + raw fetch + subprocess), OpenAI (SDK + Whisper REST), Google Gemini (REST — text-image + chat via OpenRouter), OpenRouter (meta-router: Gemini/Claude/Qwen/GLM), fal.ai (sync REST). **No DeepInfra or MiniMax call-site found in live code** (planned in F4 but not yet used anywhere).

---

## 2. Per-repo detail (grouped by capability)

### cms — `@webhouse/cms`
Already has a provider-adapter pattern (`ProviderRegistry` + named providers with PRICING) — the closest existing analogue to the SDK's `ProviderAdapter`.

- **chat / orchestration**
  - `packages/cms-ai/src/orchestrator/engine.ts:5` — `FAST_MODEL = 'claude-haiku-4-5-20251001'`; haiku-default routing
  - `packages/cms-ai/src/providers/anthropic.ts:1` — `import Anthropic from '@anthropic-ai/sdk'`; `:17` `new Anthropic({ apiKey })`; PRICING `:6-8` (sonnet-4-6, haiku-4-5, opus-4-6)
  - `packages/cms-ai/src/providers/openai.ts:1` — `import OpenAI from 'openai'`; `:15` `new OpenAI({ apiKey })`; PRICING `:5-6` (gpt-4o, gpt-4o-mini)
  - `packages/cms-ai/src/providers/registry.ts:17-24` — `ProviderRegistry` with `'anthropic'|'openai'`, defaultProvider resolution
- **content / seo agents**
  - `packages/cms-ai/src/agents/content.ts`, `agents/seo.ts`, `agents/defaults.ts`
- **image generation** → **Google Gemini** (not fal.ai)
  - `packages/cms-admin/src/lib/ai/image-generation.ts:23` — `MODEL_ID = "gemini-3-pro-image-preview"`; `:24` `generativelanguage.googleapis.com/v1beta/.../generateContent`
- **cost tracking**
  - `packages/cms-ai/src/budget/tracker.ts`; `orchestrator/runner.ts`; per-provider `PRICING` tables; `orchestrator/types.ts:61` `primaryModel`

### trail — `@trail/root`
Most transport-diverse repo: raw Anthropic API, OpenRouter, OpenAI Whisper, and a `claude -p` subprocess backend — all behind a backend-registry pattern (`ingest/runner.ts:31`).

- **chat**
  - `apps/server/src/services/chat/claude-api-backend.ts`, `chat/openrouter-backend.ts`, `chat/backend.ts`, `chat/chain.ts`
  - `apps/server/src/services/ingest/runner.ts:31` — backend map: `'claude-cli'` (subprocess) + `'openrouter'` (in-process)
  - `apps/server/src/services/ingest/backend.ts:8` — `ClaudeCLIBackend — spawns claude -p as a subprocess`
- **translate**
  - `apps/server/src/services/translation.ts:42` — `CHAT_MODEL = 'claude-haiku-4-5-20251001'`
  - `apps/model-lab/src/server/translate.ts:7` — `OPENROUTER_API_URL`; `:9` `'google/gemini-2.5-flash'`
- **vision** (embedded-image describe)
  - `apps/server/src/services/vision.ts:250` — OpenRouter Gemini-Vision; `:460` direct Anthropic-API implementation
- **transcribe** → **OpenAI Whisper**
  - `apps/server/src/services/transcription.ts:19` — `WHISPER_MODEL = 'whisper-1'`; `:38` `OPENAI_API_KEY`; `:4` pricing $0.006/min
- **extract / classify**
  - `apps/server/src/services/reference-extractor.ts`, `source-inferer.ts:41`, `contradiction-lint.ts:37-39` (`ANTHROPIC_API_KEY`, BACKEND api|cli), `action-recommender.ts:37`, `audience.ts`
- **cost tracking** (extensive)
  - `apps/server/src/services/cost-aggregator.ts`, `credits.ts`
  - `apps/model-lab/src/server/openrouter.ts:140` `estimateCost(model,…)`; `db.ts` `cost_usd`/`tokens_in`/`tokens_out`; OpenRouter PRICING `:233-244`

### buddy — `@webhouse/buddy`
The canonical **subprocess transport** reference. Spawns `claude -p` and parses token/cost from the CLI's JSON output.

- **code-review (chat over subprocess)**
  - `packages/transport/src/cli.ts:378` — `Run claude -p as a one-shot subprocess`; `:466` retry with backoff
  - `packages/cli/src/commands/cc.ts:18` — `spawn('claude', args, …)`
- **cost tracking** (from CLI JSON, not API headers)
  - `packages/transport/src/cli.ts:71-81` — Zod-parses `usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` + `total_cost_usd`
  - `:335` — `inputTokens: input_tokens + cache_read_input_tokens` ← **confirms F3.1 needs `cacheReadTokens`/`cacheCreationTokens`**

### sanneandersen — `@webhouse/sanneandersen`
All HTTP fetch, no SDKs. fal.ai uses the **synchronous** endpoint.

- **chat (Eir chatbot, tool-calling)**
  - `site/src/lib/eir/llm.ts:17` — `OPENROUTER_API`; `:25` fallback `'anthropic/claude-sonnet-4-6'`
  - `site/src/lib/eir/tools.ts`, `system-prompt.ts` — tool definitions (treatments_list/get)
  - `site/src/lib/admin-chat/types.ts:2` — "model-agnostic … provider-uafhængige"
- **image** → **fal.ai flux/schnell (SYNC)**
  - `site/src/lib/newsletter/ai-images.ts:14` — `FAL_ENDPOINT = "https://fal.run/fal-ai/flux/schnell"` (**sync `fal.run`, not async `queue.fal.run`** → F5.3 must support both modes)
  - `:49` translation step `model: "anthropic/claude-haiku-4-5"`
- **translate / voice / auto-title**
  - `site/src/lib/newsletter/voice-profile.ts:13` — `OPENROUTER_VOICE_MODEL ?? "anthropic/claude-haiku-4-5"`
  - `site/src/lib/eir/auto-title.ts:11` — OpenRouter chat
- **cost tracking:** none found in `site/src/lib`

### xrt81 — `xrt81`
Cleanest to migrate: raw `fetch`, no SDK, no cost tracking. A primary→fallback chain hardcoded inline.

- **vision** (bilingual caption/alt/tags)
  - `apps/server/src/lib/vision.ts` — `viaAnthropic()` → `fetch("https://api.anthropic.com/v1/messages")` with `x-api-key`; structured JSON prompt
- **extract (text generation, structured JSON)**
  - `apps/server/src/lib/report.ts` — `generateText()`: Anthropic direct primary, then OpenRouter fallback loop `["anthropic/claude-haiku-4.5", "google/gemini-2.5-flash"]` with `HTTP-Referer`
- **cost tracking:** none

---

## 3. Unmapped usage (candidates for new abstraction layers)

- **Multi-backend routing with fallback chains** — trail (`ingest/runner.ts` backend map), sanneandersen (`eir/llm.ts` primary→fallback), xrt81 (`report.ts` attempt loop). Three repos independently hand-roll provider failover. **Candidate: a first-class `fallback: [tier|spec, …]` option on the SDK client**, not currently in any F-plan.
- **Tool/function-calling** — sanneandersen Eir (`eir/tools.ts`) + cms agents use tools today. Confirms F4.5 (normalized tool contract) is load-bearing, not speculative.
- **`claude-cli` MCP-routed writes** — trail's `ClaudeCLIBackend` dispatches tool-calls through MCP stdio (`ingest/runner.ts:81`). The subprocess transport (F2.4) must preserve MCP passthrough, not just stdin/stdout text.
- **Synchronous fal.ai** — sanne uses `fal.run` (sync), the F5.3 plan assumed `queue.fal.run` (async). **F5.3 must handle both sync and queued modes.**
- **No DeepInfra / MiniMax live usage** — F4.3/F4.4 are forward-looking, not migrating existing code. Lower priority than adapters for providers actually in use (Anthropic, OpenAI, Gemini, OpenRouter, fal).

## 4. Migration-risk notes

| Repo | Risk | Why |
|---|---|---|
| **xrt81** | **Low** | Raw fetch, 2 files, no cost tracking, no SDK lock-in. Drop-in facade swap. Migrate first (F6.2). |
| **sanneandersen** | **Low–Med** | 5 files, fetch-only. Risk: sync `fal.run` mode + Eir tool-calling must be preserved. Good live cost-sink validation target (F6.3). |
| **buddy** | **Med** | Subprocess-only. Risk concentrated in `claude -p` JSON parsing + MCP inheritance for headless subagents. Needs F2.4 subprocess transport solid first (F6.6). |
| **trail** | **High** | ~23 files, 4 transports, MCP-routed claude-cli, tenant-encrypted keys (`ingest.ts:918`), heavy existing cost infra to reconcile with `Usage`. Migrate late, incrementally (F6.5). |
| **cms** | **High** | ~26 files, already has its *own* provider-registry + budget tracker — migration means replacing a working abstraction, not bare calls. Highest reconciliation cost (F6.4). |

**Cross-cutting:** `@webhouse/ai` is **not** a dependency in any of these repos' `package.json` (no live import found). F6.1 ("absorb @webhouse/ai") is about reproducing its tier concept, not unwiring an active dependency — reframe F6.1 accordingly.
