# F034 — Default env-based cost-sink in createAI() (auto-track every consumer)

## Problem

`createAI()` reports token cost to upmetrics ONLY when the caller explicitly passes
`costSink` (`src/client.ts:180` → `if (!cfg.costSink) return`). Across the fleet most
call-sites omit it — cardmem alone has 4 `createAI()` on `mistral-large` with **no**
sink → ~91% of Mistral spend (measured: ~125M input tokens / a €53 Jul 1–17 invoice)
is invisible to upmetrics. Per-repo wiring drifts back to un-tracked over time; the
tracking default belongs in the SDK so a consumer can never silently bypass telemetry
again.

## Solution

Make cost-tracking the DEFAULT on the **root/server entry** of `createAI()`: when
`config.costSink` is `undefined` AND the upmetrics env vars are present, auto-construct
`upmetricsSink(...)` from env. Reuse the existing `upmetricsSink`
(`src/cost/sinks/upmetrics.ts`) verbatim — no new sink type.

- **Ship-dark:** env absent → no sink (current behaviour, no crash, no POST).
- **Explicit wins:** a caller-passed `config.costSink` is always used; the env default
  is not constructed (buddy's `cli_usage` path + trail's explicit sink stay untouched).
- **Root-only env read:** only the server/root entry reads `process.env`; the browser
  build stays env-free (per `src/registry.ts`).

### Env contract

| var | required | meaning |
|---|---|---|
| `UPMETRICS_API_KEY` | yes (arms the default) | per-project `uk_` key → `X-Upmetrics-Key` header |
| `UPMETRICS_AGENT_NAME` | yes (arms the default) | consumer name dashboards group by (each repo sets once, e.g. `cardmem`) |
| `UPMETRICS_BASE_URL` | no (default `https://upmetrics.org`) | ingest base URL |
| `UPMETRICS_COMPLIANCE` | no | `=1` sets `complianceMode` for GDPR-health projects |

If either required var is missing → **no** default sink (a nameless / keyless run is
not worth an un-attributed record). This keeps the change fully ship-dark.

## Scope

- `src/client.ts` `createAI()`: construct the env default sink when `costSink` omitted.
- Reuse `upmetricsSink` as-is.
- Tests (see F034.1 AC).

## Non-goals

- No change to `upmetricsSink`'s wire shape or the explicit-costSink path.
- Does NOT switch any consumer's MODEL (e.g. cardmem `mistral-large → mistral-small`)
  — that is each repo's own follow-up card.
- No retroactive attribution of already-spent tokens — caps future blindness only.

## Dependencies

- **upmetrics.org ingest must be live** for records to LAND (down since ~Jul 10). The
  SDK change ships ship-dark regardless; tracking activates once upmetrics is back AND
  each repo has the env vars.
- Consumers bump to the new `@broberg/ai-sdk` version, set `UPMETRICS_AGENT_NAME` +
  `UPMETRICS_API_KEY`, and redeploy.

## Rollout

1. Land the `createAI()` env-sink + a RED test; publish a new `@broberg/ai-sdk` minor.
2. Announce the min version to the fleet (buddy coordinates the bump).
3. Each repo sets env vars + redeploys → auto-tracked. **cardmem first** (the culprit).
4. After upmetrics is live, verify Mistral records appear, attributed per `agentName`.

## Reuse

Checked the shared inventory: `upmetricsSink` already exists in THIS package — F034
makes it the default rather than adding a primitive. No external `@broberg/*` package
needed (this IS the shared cost primitive). Consumers reuse it by env, not by code.
