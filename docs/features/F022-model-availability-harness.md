# F022 — Model Availability Harness

> A runtime safety-net so a suspended / removed model never reaches a user as a raw provider error. `resolveModel()` + a maintained model registry + provider refresh + `listModels()`. Tier: infra/reliability. Effort: M (~1.5 days). Status: planned.

## Motivation

On **2026-06-12** Anthropic disabled **Fable 5** and **Mythos 5** globally for all customers (US export-control directive, verified against anthropic.com/news/fable-mythos-access). Every app that had `fable` configured immediately threw a raw `"claude-fable-5 may not exist or you may not have access to it"` straight into the user-facing surface. Christian's line: *that must NEVER reach the user.*

Today `@broberg/ai-sdk` has only a **reactive** fallback (`runCapability` in `src/client.ts:176` tries the next route *after* a call errors). That helps when a fallback is configured, but: (a) it still pays a failed round-trip, (b) the caller learns nothing about *why* it degraded, and (c) if no fallback is set, the raw provider error propagates. There is no **proactive** liveness check and no **shared, queryable status** that a UI model-picker can read to grey out a dead tier. F022 adds exactly that — the safety-net plus one source of truth that trickles to both the SDK call path and external UI pickers.

## Solution

A small `src/availability/` module holding **one source** of model-availability truth: a curated default registry of known-live model ids + aliases (works offline), optionally refreshed from the provider's models-list endpoint (Anthropic `GET /v1/models`, TTL-cached) so overnight changes like 06-12 are caught automatically. On top of it: `resolveModel(requested, { fallback })` for the call path (structured catchable error AND/OR transparent fallback) and `listModels()` for a shared status read that UI pickers (cardmem Dialog) consume to grey-out suspended tiers with a friendly note. No full orchestration layer — just the net + the shared read.

## Scope

### In scope
- New module `src/availability/`:
  - `types.ts` — `ModelStatus`, `ResolveResult`, `ModelUnavailableError`, `AvailabilitySource`.
  - `registry.ts` — the curated **default registry** (known-live model ids + tier aliases + per-model `available`/`note`), seeded with the Fable 5 / Mythos 5 suspension note. The single source `listModels()` and `resolveModel()` both read.
  - `resolve.ts` — `resolveModel(requested, opts)` (alias-aware preflight → `{ ok, model, requested, fellBack, status, reason }`; transparent fallback chain; optional `throwIfUnavailable` → `ModelUnavailableError`) and `listModels(opts?)` read.
  - `refresh.ts` — `refreshAvailability(opts?)`: Anthropic `GET https://api.anthropic.com/v1/models`, in-memory TTL cache (default 1h), marks registry entries absent from the live list `available:false`. Injectable `fetch` for tests.
  - `index.ts` — barrel.
- Public exports from `src/index.ts`: `resolveModel`, `listModels`, `refreshAvailability`, `ModelUnavailableError`, and the `ModelStatus` / `ResolveResult` types.
- **Opt-in** client integration in `src/client.ts`: when `cfg.availability?.autoResolve` is set, the resolved primary tier-spec model is passed through `resolveModel` before dispatch (transparent fallback honoured). Default off → existing call sites are byte-identical.
- Tests: `src/availability/resolve.test.ts`, `registry.test.ts`, `refresh.test.ts`.
- `docs/API.md` rows + changelog footer for the new surface.

### Out of scope
- A full model-orchestration / auto-routing layer (cost-aware re-selection, latency racing) — F022 is the **net + the read**, not a router. Model *selection by fit* already lives in F017 (Model Advisor).
- Refresh for non-Anthropic providers (OpenAI/Gemini/Mistral live-list polling) — defaults cover them offline; provider refresh beyond Anthropic is a future sub-story.
- Persisting availability to disk / a DB. The cache is in-memory per process; defaults are the durable floor.
- Changing the existing **reactive** `runCapability` fallback behaviour. F022 sits *in front of* it, not replacing it.
- The cc-terminal path (cardmem/buddy Dialog → raw `/model fable` → cc). The SDK is not in that loop; F022's contribution there is **data only** — `listModels()` — which the picker reads. Wiring the grey-out is cardmem's side.

## Architecture

### `src/availability/types.ts`
```ts
export type AvailabilityStatus = "available" | "suspended" | "unknown";
export type AvailabilitySource = "default" | "refresh";

/** One row of the shared status read — what a UI picker renders. */
export interface ModelStatus {
  id: string;                 // canonical provider model id, e.g. "claude-fable-5"
  alias?: string;             // tier/short alias, e.g. "fable"
  provider: string;           // "anthropic" | "openai" | "gemini" | "mistral" | ...
  available: boolean;
  status: AvailabilityStatus;
  note?: string;              // friendly reason, e.g. "suspended — US export-control directive (2026-06-12)"
  source: AvailabilitySource;
}

export interface ResolveResult {
  ok: boolean;                // the requested model itself is available
  model: string;             // id to actually use (requested if ok, else first available fallback)
  requested: string;
  provider?: string;
  fellBack: boolean;
  status: AvailabilityStatus;
  reason?: string;
}

export class ModelUnavailableError extends Error {
  readonly code = "model_unavailable";
  requested: string;
  provider?: string;
  note?: string;
  constructor(requested: string, note?: string, provider?: string) { /* ... */ }
}
```

### `src/availability/registry.ts`
A curated default keyed by model id, with alias + status + note. Seeded with current Anthropic/OpenAI/Gemini/Mistral live ids (mirrors `DEFAULT_TIER_MAP` model ids + the documented model list in CLAUDE.md), and the two suspended entries:
```ts
{ id: "claude-fable-5", alias: "fable", provider: "anthropic", available: false,
  status: "suspended", note: "suspended — US export-control directive (2026-06-12)", source: "default" },
{ id: "claude-mythos-5", alias: "mythos", provider: "anthropic", available: false,
  status: "suspended", note: "suspended — US export-control directive (2026-06-12)", source: "default" },
```
Mutable overlay (module-level Map) that `refreshAvailability` updates; defaults are the floor when no refresh has run / refresh fails.

### `src/availability/resolve.ts`
```ts
export function listModels(opts?: { provider?: string }): ModelStatus[];
export function resolveModel(
  requested: string,                                   // model id OR alias
  opts?: { fallback?: string | string[]; provider?: string; throwIfUnavailable?: boolean },
): ResolveResult;
```
- Resolve alias → id, look up status. Available → `{ ok:true, model:requested, fellBack:false }`.
- Unavailable + `fallback` → walk the chain, return first available `{ ok:false, fellBack:true, model:<fb>, reason:<note> }`.
- Unavailable + no usable fallback: `throwIfUnavailable` → throw `ModelUnavailableError`; else `{ ok:false, fellBack:false, model:requested, status, reason }` (caller decides).
- Unknown id (not in registry) → `status:"unknown"`, treated as available (fail-open — never block a model we simply don't track).

### `src/availability/refresh.ts`
```ts
export async function refreshAvailability(opts?: {
  provider?: "anthropic"; fetch?: typeof fetch; apiKey?: string; ttlMs?: number; now?: number;
}): Promise<{ refreshed: boolean; checked: number; markedUnavailable: string[] }>;
```
Anthropic `GET /v1/models` (`x-api-key`, `anthropic-version` headers). Registry anthropic entries absent from the live `data[].id` set → `available:false, status:"suspended", source:"refresh"`. In-memory TTL (default 1h) short-circuits repeat calls; `now` injectable for deterministic tests. Network/auth failure → keep defaults, `refreshed:false` (never hard-fails the SDK).

### `src/client.ts` (opt-in)
`createAI` reads `cfg.availability?.autoResolve`. When true, after `resolveTier(...)` the primary spec's `model` is run through `resolveModel(spec.model, { fallback: <configured>, provider: spec.provider })`; a fallback swap rewrites `spec.model` before dispatch. Default/unset → no behaviour change.

## Stories
- **F022.1** — Registry + types + `listModels()` shared status read (single source; Fable/Mythos suspended seed).
- **F022.2** — `resolveModel()` + transparent fallback chain + `ModelUnavailableError`.
- **F022.3** — `refreshAvailability()` (Anthropic `GET /v1/models`) + in-memory TTL cache.
- **F022.4** — Public exports in `src/index.ts`, opt-in `cfg.availability.autoResolve` client wiring, `docs/API.md` + changelog; notify cardmem that the `listModels()` shape is locked.

## Acceptance criteria
1. `resolveModel("claude-fable-5", { fallback: "claude-opus-4-8" })` → `{ ok:false, fellBack:true, model:"claude-opus-4-8", status:"suspended", reason:<note> }` (transparent degrade, no throw). Unit test passes.
2. `resolveModel("claude-fable-5", { throwIfUnavailable:true })` throws `ModelUnavailableError` with `.code === "model_unavailable"` and `.note` populated. Unit test passes.
3. `resolveModel("fable", …)` (alias) resolves identically to the canonical id (alias-aware). Unit test passes.
4. `resolveModel("claude-opus-4-8")` (known-live) → `{ ok:true, fellBack:false, model:"claude-opus-4-8" }` — zero false positives on live models. Unit test passes.
5. `listModels()` returns a stable, documented array including `{ id:"claude-fable-5", alias:"fable", available:false, note:<suspended> }` and at least one `available:true` entry — the shape cardmem's Dialog picker reads.
6. `refreshAvailability()` against a mocked Anthropic `/v1/models` that omits `claude-fable-5` marks it unavailable; an included model stays available; a second call within `ttlMs` does **not** re-fetch (assert fetch-call count). Injected-fetch unit test passes.
7. New surface exported from `src/index.ts`; `bun test` full suite green; `tsc --noEmit` clean.

## Dependencies
- None hard. Complements F017 (Model Advisor / `inventory.json`) — F022 may cross-reference inventory ids but does not require it. Independent of F014 (monthly catalogue cron).

## Rollout
Additive, single-phase. New module + exports; no breaking change to existing call sites (client integration is opt-in, default off). Ship as a **minor** (0.11.0) via the standard OIDC `publish.yml` (bump → tag → push). Rollback = revert the minor; defaults are inert without the opt-in flag. Notify cardmem (reply to intercom #4841) the moment the `listModels()` shape lands on npm so they wire the Dialog grey-out against the same source.

## Open Questions
- **Auto-resolve default on or off?** Decided: **opt-in** (`cfg.availability.autoResolve`, default off) — honours the "no orchestration layer" scope discipline and keeps existing behaviour byte-identical.
- **Refresh beyond Anthropic in v1?** Decided: **Anthropic only** in v1 (that's where the incident hit and it has a clean `GET /v1/models`). OpenAI/Gemini/Mistral live-refresh is a future sub-story; defaults cover them offline.

## Effort estimate
**M** — ~1.5 days. Self-contained module, injected-fetch tests, opt-in wiring; no provider-SDK or breaking surface changes.
