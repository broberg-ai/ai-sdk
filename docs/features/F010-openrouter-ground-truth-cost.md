# F010 — OpenRouter ground-truth cost (`usage.cost`)

> Status: planned · Epic · Priority: high
> Surfaced by: trail intercom #2581. Ships with F008 streaming + F009 json-mode.

## Motivation

The OpenRouter adapter computes `usage.costUsd` from the local pricing table via `computeCost`. Any model **without** a pricing-table entry (e.g. `anthropic/claude-haiku-4.5` via openrouter) → `computeCost` returns 0. trail caught this on a real fallback (input 89 / output 9 tokens, cost 0). Consequence: **every** call routed through openrouter — as a fallback OR a primary tier — lands in upmetrics `agent_runs` with `cost_usd=0`, i.e. real metered spend counted as free. It also breaks downstream cost reconciliation (trail F190.5).

## Scope

OpenRouter exposes the authoritative per-call cost as `usage.cost` (USD float) when the request body includes `usage:{include:true}`. That is ground-truth and beats any local estimate.

- The openrouter adapter sets `usage:{include:true}` on the request body (chat + chatStream).
- When the response `usage.cost` is a number, use it as `costUsd`; otherwise fall back to the `computeCost` pricing-table estimate (so behaviour degrades gracefully if the field is ever absent).
- Applies to non-streaming `chat` (read `usage.cost` from the JSON response) and `chatStream` (read it from the final include_usage chunk).

### Implementation note

The OpenAI-compatible core is shared by openai/deepinfra/openrouter. `usage:{include:true}` + `usage.cost` is OpenRouter-specific, so it is gated by a config flag (e.g. `costFromResponseField`) that only the openrouter adapter sets — openai/deepinfra keep the pricing-table path.

### Non-goals

- No change to anthropic/gemini/openai cost (their pricing-table compute stays).
- No retroactive correction of already-logged $0 rows.

## Stories

| # | Title | Gist |
|---|---|---|
| F10.1 | Read OpenRouter usage.cost as ground-truth | config flag + `usage:{include:true}` + read `usage.cost` (chat + chatStream) with computeCost fallback + tests |

## Rollout

Bundled into the same npm minor as F008/F009. trail + every openrouter-routing repo bumps and immediately gets accurate openrouter cost.
