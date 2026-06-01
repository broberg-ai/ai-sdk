# @broberg/ai-sdk — Plan

Unified AI/LLM SDK under the Broberg.ai umbrella. One SDK, all repos, all providers,
all capabilities — with first-class cost control on every single call.

- npm: `@broberg/ai-sdk` (org: https://www.npmjs.com/org/broberg)
- GitHub: `broberg-ai/ai-sdk` (https://github.com/broberg-ai)
- License: align with Trail (FSL-1.1-Apache-2.0) unless intended fully internal
- Replaces/absorbs: `@webhouse/ai` (tier-wrapper folds into this)

## Why not just wrap Vercel AI SDK
The earlier wrap failed because repos kept speaking the *underlying* SDK's dialect.
This is a **facade with its own contract**: repos only ever call Broberg capabilities
(`ai.vision()`, `ai.translate()`…). Vercel AI SDK can still be used internally as ONE
provider adapter — but it's an implementation detail, never the public surface.

## Core decisions (locked)
1. **Cost sink: returned + pluggable.** Every call returns a `usage` object
   (input/output tokens, cost, provider, model, transport, latency). A pluggable
   `CostSink` interface fans it out (Discord webhook / bun:sqlite / custom). No
   hardcoded ledger — trailMEM/libSQL is just one possible sink.
2. **Provider scope v1: all current.** Anthropic, OpenAI, Google Gemini, DeepInfra,
   OpenRouter (incl. MiniMax M2.7), fal.ai (image). Pluggable adapter registry.
3. **Transport: pluggable per call.** Claude can run via `claude -p` subprocess
   (Max plan → cost 0) OR Anthropic API. Chosen per call / per default policy.
   Cost model MUST reflect transport: subprocess = 0 monetary cost but still reports
   token estimates; API = real $.

## Architecture

```
@broberg/ai-sdk
├─ core/
│  ├─ client            createAI({ defaults, providers, costSink, budget })
│  ├─ capabilities/     high-level contracts (the public API)
│  │   chat translate vision image mockup design embedding
│  │   transcribe extract classify rerank
│  ├─ providers/        adapters implementing a thin ProviderAdapter iface
│  │   anthropic-api  anthropic-subprocess  openai  gemini
│  │   deepinfra  openrouter  fal  (vercel-ai optional bridge)
│  ├─ transport/        http | subprocess(claude -p)
│  ├─ cost/             pricing tables, Usage type, CostSink iface, Budget guard
│  ├─ routing/          tier map (fast/smart/powerful/cheap/vision/embedding)
│  └─ schema/           Zod on every boundary (input + structured output)
```

### Tiers (carried over from @webhouse/ai)
`fast | smart | powerful | cheap | vision | embedding` — each tier maps to a
(provider, model, transport) triple, overridable per call. Capabilities pick a
sensible default tier (e.g. `translate` → cheap, `design` → powerful).

### Capability contracts (provider-agnostic)
`mockup`, `design`, `extract`, `classify` are **Prompt Contracts** (CPM-style) layered
on `chat`/`vision`. They ship with system prompt + Zod output schema, so any text/vision
model can fulfil them and cost budgeting applies uniformly.

| Capability | I/O | Default tier | Notes |
|---|---|---|---|
| chat/complete | text→text | smart | streaming + tools |
| vision | image→text | vision | Anthropic/Gemini |
| translate | text→text | cheap | Gemini Flash / DeepInfra |
| image | prompt→image | (fal) | fal.ai primary |
| mockup | brief→HTML | smart | prompt contract |
| design | brief→tokens/SVG | powerful | prompt contract |
| embedding | text→vector | embedding | DeepInfra/OpenAI |
| transcribe | audio→text | — | synergy w/ cctalk dictation |
| extract | doc→JSON(Zod) | smart | structured output |
| classify/moderate | text→label | cheap | |
| rerank | query+docs→rank | — | DeepInfra |

### Cost & budget (the non-negotiable part)
- Every call returns a `Usage` that maps **1:1 to Upmetrics `agent_runs` metric
  fields** (snake_case at the wire boundary) so the Upmetrics sink is a thin
  forwarder, never a re-mapping layer:
  ```ts
  type Usage = {
    provider: string; model: string; tier?: string;
    transport: 'http' | 'subprocess';
    inputTokens: number; outputTokens: number;
    cacheReadTokens: number; cacheCreationTokens: number;  // Upmetrics parity
    costUsd: number;            // 0 for subprocess
    toolCalls?: { name: string; count: number; errorCount?: number }[];
    latencyMs: number; capability: string; purpose?: string; ts: string;
  }
  ```
- `Budget`: per-call and rolling (e.g. daily) ceilings in `costUsd` OR tokens.
  Pre-flight estimate → reject/throw `BudgetExceededError` before the call fires.
- Pricing tables versioned per provider/model; subprocess reports token estimates
  with `costUsd: 0` and a `subprocess: true` flag so dashboards can separate
  "free (Max)" from "paid (API)".
- `CostSink` interface: `record(usage): void | Promise<void>`. Sinks are
  composable via `multiSink([...])`.
  - **`upmetricsSink` — the canonical/primary sink.** Forwards `Usage` to the
    Upmetrics `POST /api/agent` ingest (`broberg-ai/upmetrics`). Two shapes:
    - one-shot completed call → `recordAgentRun()` (`mode: 'record'`)
    - long/streamed call → `agentRun()` lifecycle (`start` → `finish`)
    Because `Usage` already mirrors `agent_runs`, this sink does no re-mapping.
    It carries `provider`, `model`, `tier`, `purpose` as first-class fields so
    Upmetrics' existing dashboards (cost per project/day, runs per agent_name,
    success rate, p95) light up for free.
  - **Secondary sinks:** `discordSink`, `sqliteSink` (bun:sqlite, local/offline),
    `noopSink`. Used standalone for repos not wired to Upmetrics, or alongside
    it via `multiSink`.
  - **Do NOT use `@upmetrics/agent`'s `wrapAnthropic` inside the SDK.** The SDK
    owns the provider call and emits `Usage`; the sink forwards. `wrapAnthropic`
    is only for repos still on a raw provider SDK (pre-migration). Avoiding
    double-instrumentation is the key boundary.
- `complianceMode` (per Upmetrics SDK): when set, the sink strips
  prompt/response excerpts before forwarding (FysioDK/GDPR-health projects).

## Stack
Lean server-tool profile (per preference): Bun + TypeScript, Zod on all boundaries,
tsup/Bun build → dual ESM. pnpm + Turbo if it becomes a monorepo
(`@broberg/ai-sdk`, `@broberg/ai-sdk-fal`, etc. as separate adapter pkgs later).
ESM only, `import` everywhere, secrets via DotEnv (`.env`).

## Phases
- **P0 — Inventory (NOW):** run cc TRAVERSE-PROMPT.md → `AI-INVENTORY.md`. Lock real
  capability + provider matrix against actual usage.
- **P1 — Core + contracts:** client, ProviderAdapter iface, Usage/CostSink/Budget,
  tier routing, Zod boundaries. Adapters: anthropic-api, anthropic-subprocess, fal.
- **P2 — Provider breadth:** openai, gemini, deepinfra, openrouter(minimax).
- **P3 — Capabilities:** vision, translate, image, embedding, then prompt-contract
  caps (mockup, design, extract, classify, rerank).
- **P4 — Migration:** absorb `@webhouse/ai`; migrate cms, trail, buddy, sanneandersen
  (fal image), xrt81 one repo at a time behind the facade.
- **P5 — Sinks/dashboard:** sqlite + Discord sinks; optional cost dashboard
  (Recharts) reusing cronjobs/buddy patterns.

## Open questions (resolve after inventory)
- Streaming contract shape (async iterator vs callback) — match Vercel ergonomics?
- Tool/function-calling normalization across providers (biggest cross-provider pain).
- fal.ai async queue (`queue.fal.run`) — polling vs webhook handling in `image`.
- Transcribe provider choice + tie-in to cctalk Danish dictation relay.
