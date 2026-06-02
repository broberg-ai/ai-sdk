# F7 — Cost-engine v0.2 hardening: persistent budget + Whisper cost

## Role
Close the two remaining v1 cost-engine limitations so the SDK is production-grade for spend control and audio cost.

## Task
Implement: (1) a pluggable/persistent `BudgetStore` so the rolling budget survives restarts + is shared; (2) real Whisper per-minute cost via an optional audio duration. Ship as `@broberg/ai-sdk@0.2.0`.

## Context
After the SDK shipped and the xrt81 vision pilot went green (v0.1.1) and fallback + fal-cost landed (v0.1.2), two documented v1 limitations remain. Christian's call: both are worth having long-term, **persistent budget being the more important** — an in-memory rolling total resets on every process restart and is not shared across Fly instances, so it's a weak production spend-guard.

## Stories

| Story | Title |
|---|---|
| F7.1 | Pluggable BudgetStore (persistent + shared rolling budget) |
| F7.2 | Whisper per-minute cost (optional duration) |

### F7.1 — Pluggable BudgetStore
Define a `BudgetStore` interface: `{ getSpent(): Promise<number> \| number; addSpent(usd): Promise<void> \| void }`. `BudgetGuard` takes an optional `store` (default: the current in-memory counter). Ship a `sqliteBudgetStore({ dbPath, key? })` (lazy `bun:sqlite`, a `budget_spend` row keyed by an optional window key) so the rolling total persists across restarts and is shared by every process pointing at the same file. `BudgetConfig` gains an optional `store?: BudgetStore`. Because the store may be async, `check()`/`record()` stay sync-friendly but the guard reads the store before a call (the client already awaits the call flow). Backwards-compatible: omit `store` → in-memory, exactly as today.

### F7.2 — Whisper per-minute cost
Add optional `durationSec` to `TranscribeInput`. When provided, the openai adapter computes `costUsd = (durationSec / 60) * perMinuteRate` using a small audio-pricing entry (`openai:whisper-1` = $0.006/min). When absent, cost stays 0 (documented). Token-based capabilities are unaffected.

## Non-goals
- No redis/remote BudgetStore in v0.2 (sqlite + in-memory only; the interface makes redis a later drop-in).
- No automatic audio-duration probing (caller passes `durationSec`).
- No change to the cost-sink contract or `Usage` shape.

## Rollout
Implement both → tests → bump minor to `0.2.0` → tag `v0.2.0` → OIDC publish → Node-install verify. Update docs/API.md (move persistent-budget + Whisper out of limitations).

## Acceptance criteria
1. Pluggable `BudgetStore`: rolling total persists across process restarts (sqlite-backed) + default in-memory store unchanged
2. Whisper transcribe computes per-minute cost when a duration is provided
3. No breaking change to existing `createAI({ budget })` usage (in-memory default)
4. Published as `@broberg/ai-sdk@0.2.0`, Node-install verified
