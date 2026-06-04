# F014 — Monthly Model-Catalogue Research Cron

> A scheduled job that researches the live model + pricing catalogue across every provider the SDK supports (including all models OpenRouter exposes) and keeps the SDK's catalogue fresh — so we always have the newest models on the tier/pricing lists and never silently under-count cost. Tier: infra/cost. Effort: M-L. Status: planned (cron wiring blocked on upmetrics pattern + key).

## Motivation

The pricing/model catalogue drifts out of date the moment a provider ships or renames a model, and the drift is **silent and expensive**:

- **2026-06-04 — the `$0` bug.** A real live Gemini key revealed that every gemini-direct call logged `costUsd = $0`, because the pricing table keyed the model under `google:` while the adapter stamps `gemini:` (fixed in v0.5.1). Nobody noticed for weeks because the catalogue is hand-maintained and never cross-checked against the providers.
- Same class as F012 (dated-snapshot models → `$0`). Both are symptoms of one root cause: **`src/cost/pricing.ts` and `src/routing/tier-map.ts` are maintained by hand and have no feedback loop telling us when a model is new, renamed, re-priced, or removed upstream.**
- New models (e.g. a new Claude/Gemini/GPT snapshot, or anything new OpenRouter adds) are unreachable or mis-priced until someone manually edits the table.

We want a monthly heartbeat that fetches the real catalogue from each provider, diffs it against what the SDK knows, and proposes the patch — keeping the catalogue a living, reviewed artifact instead of a drifting one.

## Solution

A research engine (lives in ai-sdk, next to the pricing table it diffs against) that:
1. Fetches model lists + pricing from each provider's models API — OpenRouter `GET /api/v1/models` is the canonical multi-vendor source (public, pricing included, covers everything OpenRouter routes to); direct-provider list endpoints cover new-model detection for anthropic/openai/gemini/deepinfra/fal.
2. Normalizes everything to one `CatalogueModel` shape and diffs it against `src/cost/pricing.ts` (`PRICING`) + `src/routing/tier-map.ts`.
3. Emits a structured diff report (added / price-changed / missing-from-table / removed-upstream) and **proposes a patch** — primary path is an auto-opened PR against `pricing.ts`, plus a human-readable summary posted to a sink for visibility.

cronjobs.webhouse.net schedules it monthly, mirroring upmetrics' existing cron pattern (key supplied by upmetrics).

## Scope

### In scope
- `src/catalogue/fetchers.ts` — per-provider model-list fetchers, normalized to `CatalogueModel`. OpenRouter `/api/v1/models` is the pricing-bearing source; anthropic/openai/gemini/deepinfra/fal list endpoints for new-model detection. Reuses `src/transport/http.ts`.
- `src/catalogue/diff.ts` — compares the fetched catalogue against `PRICING` (`src/cost/pricing.ts`) + `DEFAULT_TIER_MAP` (`src/routing/tier-map.ts`) → a `CatalogueDiff` report.
- `scripts/research-models.ts` — thin runner: fetch → diff → render markdown report → deliver. Runnable as `bun run scripts/research-models.ts`.
- Delivery: auto-open a GitHub PR that patches `pricing.ts` with new/changed entries (reviewable, never auto-merged) + a summary line to a `CostSink`/Discord for visibility.
- Cron registration on **cronjobs.webhouse.net** (monthly, 1st of month), mirroring upmetrics' job pattern; wired with the upmetrics-supplied key.
- Tests: `src/catalogue/diff.test.ts` against fixture catalogues (added/changed/missing/removed cases) — no live network in the suite.

### Out of scope
- **Auto-merging** pricing changes. The cron PROPOSES (PR/report); a human or cc reviews + merges. Keeps `pricing.ts` the single reviewed source of truth (ALDRIG-hardcoded rule: one source, reviewed).
- Auto-editing `tier-map.ts` (default routing). Tier choices are product decisions — the report may *flag* a stale tier model, but never silently re-route.
- Real-time pricing. Monthly cadence is deliberate; intra-month price changes are caught next run.
- Scraping provider marketing/docs pages for pricing where no API exposes it. Direct-provider pricing without an API is cross-checked against OpenRouter's number for the same model; anything still unknown is reported as "needs manual price", not invented.
- Building a new cron host. We register on the existing cronjobs.webhouse.net.

## Architecture

### `CatalogueModel` (normalized shape) — `src/catalogue/types.ts`
```ts
interface CatalogueModel {
  provider: string;        // "openrouter" | "anthropic" | "openai" | "gemini" | "deepinfra" | "fal"
  model: string;           // provider-native id, e.g. "gemini-2.5-flash" or "google/gemini-2.5-flash"
  inputPer1M?: number;     // USD per 1M input tokens (undefined if the API doesn't expose price)
  outputPer1M?: number;    // USD per 1M output tokens
  contextLength?: number;
  deprecated?: boolean;
}
```

### Fetchers — `src/catalogue/fetchers.ts`
- `fetchOpenRouterCatalogue()` → `GET https://openrouter.ai/api/v1/models` (public). Maps each entry's `pricing.prompt`/`pricing.completion` (USD per token) → `*Per1M`. This single call covers **all models OpenRouter gives access to**.
- `fetchOpenAICatalogue()` → `GET /v1/models` (key). List only (no price) → new-model detection.
- `fetchAnthropicCatalogue()` → models list endpoint. List only.
- `fetchGeminiCatalogue()` → `GET /v1beta/models` (ListModels). List only.
- `fetchDeepinfraCatalogue()` / `fetchFalCatalogue()` → provider model listings where available.
- All go through `src/transport/http.ts`; each is independently failable (one provider down ≠ whole run fails).

### Diff engine — `src/catalogue/diff.ts`
```ts
interface CatalogueDiff {
  added:        CatalogueModel[];   // upstream has it, our PRICING does not
  priceChanged: { key: string; old: PricingEntry; now: CatalogueModel }[];
  missingPrice: CatalogueModel[];   // reachable but no price in our table → would log $0
  removedUpstream: string[];        // our PRICING/tier-map lists it, upstream no longer does
}
export function diffCatalogue(fetched: CatalogueModel[]): CatalogueDiff
```
Cross-checks every `PRICING` key (`provider:model`) and every `DEFAULT_TIER_MAP` spec against the fetched set. `missingPrice` is the direct guard against the F012/v0.5.1 `$0` class of bug.

### Delivery — `scripts/research-models.ts`
- Renders `CatalogueDiff` as markdown.
- If non-empty: opens a PR against `broberg-ai/ai-sdk` patching `src/cost/pricing.ts` (via `gh` / GitHub App) with the proposed entries; posts a one-line summary to a sink (Discord webhook or upmetrics) so the run is visible even when there's nothing to change.
- Exit code reflects "drift found" vs "clean" for cron observability.

### Cron — cronjobs.webhouse.net
- Monthly schedule (1st, arn timezone). Mirrors upmetrics' existing job (pattern + auth + key to be supplied by upmetrics — see Dependencies / Open Questions).
- Job either checks out a pinned ai-sdk ref and runs `bun run scripts/research-models.ts`, or hits a thin endpoint — decided by upmetrics' pattern.

## Stories
- **F014.1** — `CatalogueModel` types + per-provider fetchers (`src/catalogue/fetchers.ts`); OpenRouter `/api/v1/models` pricing-bearing fetch + direct-provider list endpoints, each independently failable.
- **F014.2** — Diff engine (`src/catalogue/diff.ts`) comparing fetched catalogue vs `PRICING` + `DEFAULT_TIER_MAP`; emits `CatalogueDiff` with added / priceChanged / missingPrice / removedUpstream. Unit-tested against fixtures.
- **F014.3** — `scripts/research-models.ts` runner: render markdown report + open an auto-PR patching `pricing.ts` + post a summary to a sink. Never auto-merges.
- **F014.4** — Cron registration on cronjobs.webhouse.net (monthly), mirroring upmetrics' pattern; wire the upmetrics-supplied key. **Blocked on upmetrics reply (intercom #3024).**
- **F014.5** — Drift alert: when a model in `tier-map.ts`/`PRICING` has disappeared upstream (`removedUpstream` non-empty), flag it loudly in the report (inverse of the `$0` bug — we keep pricing for a model that no longer exists).

## Acceptance criteria
1. `bun run scripts/research-models.ts` fetches the OpenRouter catalogue live and prints a `CatalogueDiff` covering ≥1 real "added" or "missingPrice" entry when the table is behind (verified against a deliberately-stale fixture and one live run).
2. `src/catalogue/diff.test.ts` passes: fixture cases for added, priceChanged, missingPrice, and removedUpstream each produce the correct bucket; suite makes **no live network calls**.
3. A run with drift opens (or updates) exactly one PR against `broberg-ai/ai-sdk` patching `src/cost/pricing.ts`; a clean run opens no PR and still posts a visible "catalogue clean" summary.
4. The diff engine flags the v0.5.1 bug class: a model reachable via a provider adapter but absent from `PRICING` appears in `missingPrice` (regression guard against silent `$0`).
5. The cron is registered on cronjobs.webhouse.net and a manual trigger produces a report within 60s (runtime-verified, not just "configured").

## Dependencies
- **upmetrics** — cronjobs.webhouse.net setup pattern + job-auth/result key (intercom #3024 sent; gates F014.4).
- F012 (dated-snapshot pricing normalization) + v0.5.1 (gemini provider-key fix) — the `$0`-bug precedents this feature systematizes against. Both shipped.
- `src/cost/pricing.ts` (`PRICING`, `getPrice`), `src/routing/tier-map.ts` (`DEFAULT_TIER_MAP`), `src/transport/http.ts` — all exist.

## Rollout
Phased, each story a green commit:
1. F014.1 + F014.2 land the fetch+diff engine with tests — pure library, no side effects, safe to ship in any patch release.
2. F014.3 adds delivery (PR + summary) — first dry-run with `--no-pr` to print-only, then enable PR opening.
3. F014.4 registers the cron once upmetrics' pattern + key land; first run is a manual trigger (observe the report), then enable the monthly schedule.
4. F014.5 is additive (an extra report bucket).
Rollback: the cron only ever opens PRs / posts summaries — it never mutates `pricing.ts` directly, so "rollback" is closing a PR. Disabling the cron job stops all activity with zero residue.

## Open Questions
- **Delivery mechanism** — auto-PR patching `pricing.ts` (lean: yes, keeps one reviewed source) vs report-only to a sink vs a cardmem card/idea? Plan assumes auto-PR + summary; confirm with Christian.
- **cronjobs run model** — does the job check out a pinned ai-sdk ref and `bun run` the script, or hit a thin HTTP endpoint? Decided by upmetrics' pattern (#3024).
- **Direct-provider pricing** — anthropic/openai/gemini list endpoints expose models but not price. Cross-ref OpenRouter's number for the same model; report the rest as "needs manual price". Acceptable, or do we want a maintained per-provider price source?
- **Which sink for the summary** — Discord webhook vs upmetrics vs both?

## Effort estimate
**M-L** — ~2-3 days. F014.1+F014.2 (~1 day, the testable core), F014.3 delivery (~0.5 day), F014.4 cron wiring (~0.5 day, gated on upmetrics), F014.5 (~0.25 day).
