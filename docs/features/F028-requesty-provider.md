# F028 — Requesty provider (OpenRouter-alternative AI gateway, EU endpoint)

> Tier: provider. Effort: S. Status: building. A drop-in alternative to the `openrouter` upstream.

## Motivation

We use OpenRouter in several places (e.g. trail) as the "one key → many models" aggregator so apps don't mint a key per provider. [Requesty](https://requesty.ai) is a direct alternative in the same category — an OpenAI-compatible AI gateway (400+ models, 30+ providers) with cost/latency/availability routing, prompt caching, observability, governance (RBAC, PII-masking) — **and an EU data-residency endpoint** (`router.eu.requesty.ai`) that OpenRouter lacks. Christian wants Requesty available as a first-class upstream so apps can choose it wherever they use OpenRouter today, with the EU option as a bonus.

This does NOT replace ai-sdk: ai-sdk stays the facade + chokepoint (cost-tracking, GDPR-gating, fallback). Requesty is simply one more swappable OpenAI-compatible upstream, exactly like `openrouter`.

## Solution

A thin `requestyAdapter` built on the existing `makeOpenAICompatibleAdapter` (same as `openrouterAdapter`) — base URL + key + `costFromResponseField`. US default, EU endpoint via an `eu` flag. Apps reach it via `override:{ provider:"requesty", model:"openai/gpt-4o" }` or a configured tier map; key from `REQUESTY_API_KEY`. Ship-dark (inert without the key).

## Scope

### In scope
- `src/providers/requesty.ts` — `requestyAdapter({ apiKey?, baseUrl?, eu?, referer?, title? })` → `makeOpenAICompatibleAdapter`:
  - US default `https://router.requesty.ai/v1`; EU `https://router.eu.requesty.ai/v1` when `eu:true` (or explicit `baseUrl`).
  - `name:"requesty"` → key auto-resolves from `REQUESTY_API_KEY`; `Authorization: Bearer <key>`.
  - `costFromResponseField:true` — Requesty returns ground-truth `usage.cost` by default (verified in docs), so `usage.costUsd` is exact, not an estimate.
- Register `requesty: requestyAdapter()` in `src/providers/registry.ts`.
- Export `requestyAdapter` from `src/index.ts`.
- `src/providers/requesty.test.ts` — mocked `globalThis.fetch` (mirrors `openrouter.test.ts`): US + EU base URL, `Authorization`, model slug passthrough, `usage.cost` → `costUsd`, `REQUESTY_API_KEY` env resolution + ship-dark throw.
- `docs/API.md` — short note: Requesty as an OpenRouter-alternative upstream + the EU-residency caveat.

### Out of scope
- **Making Requesty a DEFAULT tier** — like `openrouter`, it's opt-in per app (no change to `DEFAULT_TIER_MAP`).
- **Requesty-specific routing policies** (`policy/...` slugs) — they pass through as any model string; no special handling needed.
- **Streaming-cost nuance** — the shared core already sets `stream_options:{include_usage:true}` + reads `usage.cost`; nothing Requesty-specific.
- **Replacing OpenRouter** — both coexist; apps choose.

## Architecture

### `requestyAdapter` (`src/providers/requesty.ts`)
```ts
const US_BASE = "https://router.requesty.ai/v1";
const EU_BASE = "https://router.eu.requesty.ai/v1";
export function requestyAdapter(config: { apiKey?: string; baseUrl?: string; eu?: boolean; referer?: string; title?: string } = {}): ProviderAdapter {
  return makeOpenAICompatibleAdapter({
    name: "requesty",
    baseUrl: config.baseUrl ?? (config.eu ? EU_BASE : US_BASE),
    apiKey: config.apiKey,
    costFromResponseField: true,
  });
}
```
Identical shape to `openrouterAdapter` — the OpenAI-compatible core does chat + chatStream + vision.

### GDPR caveat (document, don't over-promise)
The EU endpoint keeps only **Requesty's gateway processing** in the EU (Frankfurt / AWS eu-central-1). **End-to-end EU residency still requires an EU-region MODEL** — Requesty's docs are explicit: a global slug like `anthropic/claude-sonnet-4-5` routes inference OUTSIDE the EU despite the EU endpoint. EU-resident inference uses region-suffixed slugs (Bedrock `@eu-central-1`, Vertex `@eu`, Azure `@swedencentral`, Mistral EU-default). So for personal/health data: `eu:true` AND an EU-region model — never the EU endpoint with a global model. For non-personal dev workloads (e.g. trail transcript summarization), the model region is moot.

## Stories
- **F028.1** — `requestyAdapter` + registry/export + mocked-fetch tests (US + EU base, auth, cost-from-response, ship-dark).
- **F028.2** — `docs/API.md` note (OpenRouter-alternative + EU-residency caveat); optional live smoke once a `REQUESTY_API_KEY` exists.

## Acceptance criteria
1. `requestyAdapter({ apiKey:"k" }).chat({...})` POSTs to `https://router.requesty.ai/v1/chat/completions` with `Authorization: Bearer k`; `eu:true` → `https://router.eu.requesty.ai/v1/...` — mocked-fetch test.
2. A model slug (`openai/gpt-4o`) passes through to the wire `model` field; response `usage.cost` becomes `usage.costUsd` (ground-truth, not estimate) — asserted.
3. No key + no `REQUESTY_API_KEY` → a clear "API key not set" throw only when called (ship-dark); `usage.provider==="requesty"`.
4. Registered in the default registry + exported from the barrel; full suite + typecheck green.

## Dependencies
- `makeOpenAICompatibleAdapter` (F4.5) — exists. None blocking.
- A `REQUESTY_API_KEY` is needed only for a live call (not for build/tests).

## Rollout
Additive, ship-dark. New opt-in upstream; no change to defaults or existing callers. Rollback = drop the registry entry. Apps adopt by setting `REQUESTY_API_KEY` + choosing `provider:"requesty"`.

## Open Questions
None blocking. (Whether to default `requesty` to the EU endpoint fleet-wide is a per-app choice; left US-default to match the vendor + `openrouter`.)

## Effort estimate
**S** — ~an hour. The adapter is ~15 lines (mirrors `openrouter`); the work is the tests + docs + the GDPR caveat.
