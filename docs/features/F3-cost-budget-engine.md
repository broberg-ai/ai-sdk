# F3 — Cost & budget engine (returned + pluggable sink)

## Role
Make cost a first-class output on every AI call — returned in the response and fanned out to any configured sink.

## Task
Every capability call returns a `Usage` object. A `BudgetGuard` rejects calls that would breach ceilings before firing. A `CostSink` interface fans out to Discord, bun:sqlite, noop, or any combination.

## Context
**Locked decisions:**
- Cost is *returned* by the call (not only logged) — callers can read it directly
- Cost is *pluggable* via `CostSink` — not a hardcoded ledger
- `claude -p` subprocess calls report `costUsd: 0` with a `subprocess: true` flag; dashboards use this flag to separate Max-plan-free calls from paid API calls
- Pricing tables are versioned per `(provider, model)` so a model price change doesn't silently corrupt historical data

## Non-goals
- No dashboard or UI — that is a separate consumer of the sink data
- No cross-session budget aggregation (rolling ceiling is per-`createAI` instance, in-memory)
- No persistent ledger built-in — `sqliteSink` gives you one if you want it

## Stories

| Story | Title |
|---|---|
| F3.1 | Usage type + per-call cost computation |
| F3.2 | Budget guard |
| F3.3 | CostSink interface + noopSink + multiSink |
| F3.4 | discordSink |
| F3.5 | sqliteSink (bun:sqlite) |
| F3.6 | Pricing tables |

## Acceptance criteria
1. Every capability call returns a `Usage` object: `{ inputTokens, outputTokens, costUsd, provider, model, transport, latencyMs, capability, ts }`
2. Subprocess calls report `costUsd: 0` with `subprocess: true` and token estimates
3. `BudgetGuard` rejects calls exceeding per-call or rolling ceiling via `BudgetExceededError` — thrown *before* the transport fires
4. `CostSink` interface with `discordSink`, `sqliteSink`, `noopSink`, `multiSink` implemented
5. Pricing tables versioned per `(provider, model)` and covered by unit tests
