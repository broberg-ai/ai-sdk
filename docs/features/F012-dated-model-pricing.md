# F012 — Price dated model snapshots (cost under-count fix)

> Status: planned · Epic · Priority: high · Ships 0.4.1
> Found by upmetrics (#2691, Christian-requested).

## Problem

`getPrice(provider, model)` looks up `PRICING["${provider}:${model}"]` by EXACT key. Anthropic (and others) ship **dated model snapshots** — e.g. `claude-haiku-4-5-20251001`. That exact key isn't in the table, so `getPrice` returns undefined → `computeCost` returns 0. Result: a real paid call is logged with `cost_usd=0` — a cost **under-count**, not merely a display gap. upmetrics caught trail's translation runs (`claude-haiku-4-5-20251001`, http, ~1800/1300 tokens) at $0.

Distinct from F010 (which fixed openrouter via ground-truth `usage.cost`); this is the pricing-table path used by anthropic-direct + any provider without a returned cost field.

## Fix

`getPrice` normalizes a trailing ` -YYYYMMDD` date suffix off the model id and retries the base lookup:

```ts
export function getPrice(provider, model) {
  const exact = PRICING[`${provider}:${model}`];
  if (exact) return exact;
  const base = model.replace(/-\d{8}$/, "");
  if (base !== model) return PRICING[`${provider}:${base}`];
  return undefined;
}
```

Covers anthropic-direct (`claude-haiku-4-5-20251001` → `claude-haiku-4-5`) AND openrouter slugs (`anthropic/claude-haiku-4-5-20251001` → `anthropic/claude-haiku-4-5`), current + future dated variants. No table churn.

### Non-goals
- Not adding every dated snapshot as its own row (normalization is the durable fix).
- No change to F010 openrouter ground-truth path.

## Stories

| # | Title | Gist |
|---|---|---|
| F12.1 | Normalize dated model id in getPrice | strip trailing -YYYYMMDD + base lookup + tests (dated anthropic + openrouter variants price correctly) |

## Rollout

Patch 0.4.1. trail bumps → translation cost becomes real instead of $0.
