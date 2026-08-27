# F040 — Four providers cache automatically and we bill them as if they did not

> **Status: backlog.** Audit run 2026-08-27 on Christian's instruction: *"check ALLE
> vores modeller i ai-sdk om nogen af dem kan caches og IKKE er det."*

## The audit

| provider | sends a cache param | reads the count back | rows priced |
|---|---|---|---|
| **anthropic** | ✅ `cache_control` | ✅ | 3/3 |
| **mistral** | ✅ `prompt_cache_key` (F039) | ✅ | 18/18 |
| **openai** | not needed — automatic | ✅ (rides the openai-compatible path) | **0/5** |
| **deepseek** | not needed — automatic | ❌ field name differs | **0/2** |
| **gemini** | not needed — automatic | ❌ | **0/2** |
| **vertex** | not needed — automatic | ❌ | **0/2** |

*(openrouter reports ground-truth `usage.cost`, so its cost is already right; only
its cached-token visibility is missing.)*

## The distinction that decides the priority

**F039 was losing real money.** Mistral would not cache at all without a key, so
every repeated instruction was paid for in full, forever.

**This is not that.** openai, deepseek, gemini and vertex cache *automatically* — the
provider has already applied the discount by the time we see the response. Nothing is
being wasted.

**What is wrong is the number we report.** `computeCost` prices the full prompt at the
full input rate, so our own cost figure is too high. That figure feeds the budget guard
and the cost sink — i.e. the numbers used to decide whether a workload is affordable.
A confident wrong number is the failure mode this repo spent two days establishing is
worse than no number at all.

## Why it is four small jobs, not one

The field name differs per provider, which is exactly why the shared openai-compatible
read does not already cover them:

- openai / openrouter / requesty / deepinfra — `prompt_tokens_details.cached_tokens`
- deepseek — `prompt_cache_hit_tokens` (+ `prompt_cache_miss_tokens`)
- gemini / vertex — `usageMetadata.cachedContentTokenCount`

## The trap to measure, not assume

Mistral's `prompt_tokens` **includes** the cached tokens, while `computeCost` adds
`cacheReadTokens` **on top of** `inputTokens` — so F039 had to subtract. Whether each
of these four providers counts the same way is a separate question per provider, and
getting the direction wrong silently double-bills or under-bills. Measure it; do not
carry the Mistral assumption across.

Likewise every discount rate goes into `pricing.ts` only after being read from the
provider's own response or its published pricing page, with the source and date in the
row's `version` string. A rate recalled from memory is the same class of error as the
tier table that was wrong for two months.

## Non-goals

- No caching for providers that do not offer it.
- No change to `promptCacheKey` — only Mistral takes a key (F039.2).

## Reuse

No `@broberg/*` package owns LLM transport; this repo is the fleet's AI primitive.
