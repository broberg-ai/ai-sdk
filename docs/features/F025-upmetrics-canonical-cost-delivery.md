# F025 — Upmetrics as the canonical cost-delivery method (+ cost read-back client)

> Tier: cost/observability. Effort: S–M. Status: planned (plan-doc only; build pending scope-confirm on the open questions below).

## Motivation

`@broberg/ai-sdk` already emits per-call `Usage` (tokens + USD + latency) to cost **sinks** — today `upmetricsSink`, `discordSink`, `sqliteSink`, `multiSink`, `noopSink` are presented as peers. But the picture changed: **Upmetrics now owns cost *aggregation*.** Its public cost read-API (`docs/COST-API.md`, F014) already does the roll-up the SDK side keeps half-reinventing:

- `GET /api/cost/summary` — totals + `by_provider/model/tier/capability`, `groupBy=<tag>` per-tenant, integer **micro-USD** precision (rounds once at the boundary so sub-cent calls aren't lost), `metered` vs free split.
- `GET /api/cost/timeseries` — per-bucket series for a graph.
- `GET /api/cost/fleet` — org-wide per-agent digest (separate `X-Upmetrics-Fleet-Key`).

Christian's steer (card F025): *"Der var en option for hvor cost skulle leveres … Upmetrics har et oplæg på hvordan den skal kunne samle cost op allerede. Så Upmetrics er 1 metode og de andre du nævnte er ekstra metoder."* → **Upmetrics is method #1 (canonical — it aggregates); discord/sqlite are *extra* methods.** Two gaps follow: (1) the SDK has a *write* sink but **no read helper**, so a consuming app that wants its own accumulated cost re-rolls its own aggregation (e.g. the local `sqlite` `getCostSummary`) instead of leaning on the canonical source; (2) nothing in code/docs marks upmetrics as the default — all sinks read as equals.

## Solution

1. Add a thin, browser-safe **cost read-back client** (`upmetricsCostClient`) over the Upmetrics COST-API — so the SDK both *writes* (sink) and *reads* (aggregated) from one canonical source. No new aggregation engine in the SDK; Upmetrics owns the math.
2. **Position** `upmetricsSink` as the documented default cost-delivery method; `discord`/`sqlite`/`multi` explicitly secondary ("extra methods").
3. (Open Q) Optionally let `createAI()` ship-dark auto-wire `upmetricsSink` when `UPMETRICS_API_KEY` + base URL are in env, instead of `noopSink`.

## Scope

### In scope
- `src/cost/upmetrics-read.ts` — `upmetricsCostClient({ baseUrl, apiKey, fetch? })` → `.summary(opts)`, `.timeseries(opts)`; optional `.fleet(opts)` taking a separate fleet key. Typed responses mirroring `COST-API.md` (integer `micro_usd`, `generated_at`, breakdown rows `{key, micro_usd, input_tokens, output_tokens, run_count}`). Filters: `window|from|to`, `provider`, `model`, `tier`, `agent_name`, `transport`, `tag.<k>`, `groupBy`.
- Export the client + its result types from `src/index.ts`. **Browser-clean**: must NOT transitively import `bun:sqlite` (keep it consumable from the F022.5 `@broberg/ai-sdk/registry`-style clean path).
- `src/cost/upmetrics-read.test.ts` — mocked-`fetch` coverage: summary shape, timeseries shape, `groupBy`, 401 `invalid_api_key`, network-error behaviour.
- `docs/API.md` — a `## Cost delivery` section: upmetrics = canonical (#1, it aggregates + has the read-API), discord/sqlite = extras; document the read client.

### Out of scope
- **Changing the ingest wire shape** — `upmetricsSink` already maps `Usage` → `/api/agent` per `AGENT-SCHEMA.md`; untouched.
- **A new aggregation/roll-up engine in the SDK** — that is exactly what Upmetrics owns; the SDK must not duplicate it.
- **Any UI / dashboard** — the consuming app renders; Upmetrics has its own dashboard.
- **Removing or deprecating** discord/sqlite/multi/noop sinks — they stay as extras.
- **Currency conversion** — USD is source of truth (per COST-API.md); FX is the display layer's job.

## Architecture

### `upmetricsCostClient` (`src/cost/upmetrics-read.ts`)
```ts
export interface UpmetricsCostClientConfig { baseUrl: string; apiKey: string; fetch?: typeof fetch; }
export interface CostSummaryOpts { window?: "day"|"week"|"month"; from?: string|number; to?: string|number;
  provider?: string; model?: string; tier?: string; agentName?: string; transport?: "http"|"subprocess";
  tags?: Record<string,string>; groupBy?: string; }
export interface CostSummary { generated_at: string; window: { from: string; to: string };
  total_micro_usd: number; input_tokens: number; output_tokens: number; cache_read_tokens: number;
  cache_creation_tokens: number; run_count: number; metered: { metered_micro_usd: number; free_run_count: number };
  by_provider: CostRow[]; by_model: CostRow[]; by_tier: CostRow[]; by_capability: CostRow[];
  group_by?: string; by_group?: CostRow[]; }
export interface CostRow { key: string; micro_usd: number; input_tokens: number; output_tokens: number; run_count: number; }
export function upmetricsCostClient(cfg: UpmetricsCostClientConfig): {
  summary(o?: CostSummaryOpts): Promise<CostSummary>;
  timeseries(o?: CostTimeseriesOpts): Promise<CostTimeseries>;
};
```
- Auth header `X-Upmetrics-Key: <apiKey>` (same per-project `uk_` key the sink uses for ingest). 401 → throws a typed `UpmetricsCostError`. `tag.<k>` built from `tags`. Helper `usdFromMicro = (m)=>m/1_000_000`.
- Pure `fetch`, zero new deps, no `bun:sqlite` import → browser/Vite-clean.

### Positioning (`src/cost/sinks/index.ts` + `docs/API.md`)
- Doc-level: upmetrics is the default; others are extras. No code-removal.

## Stories
- **F025.1** — `upmetricsCostClient` read-back client (summary + timeseries) + mocked-fetch tests. *(story card already created)*
- **F025.2** — `docs/API.md` `## Cost delivery` section: upmetrics canonical (#1), discord/sqlite extras; document the read client.
- **F025.3** *(gated on Open Q)* — `createAI()` ship-dark auto-wires `upmetricsSink` when `UPMETRICS_API_KEY` + base URL in env; else `noopSink` (unchanged).

## Acceptance criteria
1. `upmetricsCostClient({baseUrl,apiKey}).summary({window:"month"})` returns a typed `CostSummary` (integer `micro_usd`, `by_provider/model/tier/capability`) — verified by a mocked-fetch test asserting the parsed shape.
2. `.timeseries({bucket:"day",window:"month"})` returns typed `points[]`; mocked-fetch test green.
3. `groupBy:"tenantId"` yields `by_group[]`; a `401 {"error":"invalid_api_key"}` surfaces as a thrown `UpmetricsCostError` (not a silent empty) — both covered by tests.
4. Importing `upmetricsCostClient` does NOT pull `bun:sqlite` into the bundle (assert via the existing browser-clean import guard / no native dep on that path).
5. `docs/API.md` has a `## Cost delivery` section naming upmetrics canonical (#1) and discord/sqlite as extras.
6. Full `bun test` suite green; version bumped + published via `publish.yml`; components pinged with the shipped version.

## Dependencies
- Upmetrics COST-API (their F014) — live + public (`upmetrics/docs/COST-API.md`). No blocking SDK dependency.
- Relates to: existing `upmetricsSink` (write side), F022.5 browser-clean subpath (keep the read client clean).

## Rollout
Additive, single-phase — new export, no breaking change to existing sinks or `createAI()`. The optional default-wire (F025.3) sits behind env presence (ship-dark → `noopSink` when unset), so prod stays inert until `UPMETRICS_API_KEY` is set. Rollback = drop the new export; nothing else changes.

## Open Questions
1. **Default-wire?** Should `createAI()` auto-default the cost sink to `upmetricsSink` when `UPMETRICS_API_KEY` (+ base URL) are in env, instead of today's explicit injection? Changes default behaviour for every consumer → **Christian's call** (this is F025.3's gate).
2. **Fleet read in the SDK?** Include `.fleet()` (separate `X-Upmetrics-Fleet-Key`) here, or leave the org-wide digest to buddy only?
3. **Ergonomics:** standalone `upmetricsCostClient(...)` (matches the sink-factory style) vs a first-class `ai.cost.summary(...)` method on the client surface?

## Effort estimate
**S–M** — ~0.5–1 day. The read client + tests are ~half a day; docs + the optional default-wire are small but Q1/Q3 want a decision first.
