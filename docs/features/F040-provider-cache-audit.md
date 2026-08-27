# F040 — Four providers cache automatically and we bill them as if they did not

> **Status: gemini + vertex shipped 2026-08-27 (F040.1). openai + deepseek UNVERIFIED — no key on this machine.**
>
> Original status: backlog. Audit run 2026-08-27 on Christian's instruction: *"check ALLE
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


## F040.1 — what shipped, and what did not

### Gemini + Vertex: measured, wired, live-proven

**Gemini caches implicitly** — no opt-in, no key. Measured on an 11,408-token
repeated prefix:

```
promptTokenCount 11408   cachedContentTokenCount 11242
```

So the prompt count **includes** the cached tokens and they must be subtracted, the
same direction as Mistral. `splitCached()` in `gemini.ts` owns that rule and Vertex
imports it rather than keeping a second copy — a guard test fails if the raw pattern
reappears there, because two copies of one rule is exactly how the tier map and the
registry drifted apart for two months.

Rates read from `ai.google.dev/gemini-api/docs/pricing` on 2026-08-27, not recalled:
$0.03 vs $0.30 (2.5-flash) and $0.01 vs $0.10 (2.5-flash-lite) — **10%** for both. The
storage fee on that page applies to EXPLICIT context caching (a `CachedContent` object
with a TTL); implicit caching has none, so the table is not silently under-billing.

Live through `ai.chat`:

```
call 1  input=11406  cached=    0  cost=$0.003424
call 2  input=  169  cached=11237  cost=$0.000388   ← 89% cheaper
```

**A correction worth keeping.** My first run concluded that a `systemInstruction`
prefix does not participate in implicit caching, because 3 calls produced no hit while
a `contents` prefix hit on call 3. Giving `systemInstruction` the same number of
attempts showed it hitting on call 5. **The difference was sample size, not placement**
— the exact trap I had spent the day warning peers about, walked into within an hour.

**And implicit caching is opportunistic, not guaranteed.** In the live run only call 2
hit; calls 3–6 missed on the same prefix. So this is a real saving to report correctly,
not a saving to promise. Unlike Mistral's keyed caching, which hit every time.

### openai + deepseek: UNVERIFIED, deliberately

No `OPENAI_API_KEY` or `DEEPSEEK_API_KEY` on this machine, so neither the discount rate
nor the inclusion semantics (does their prompt count contain the cached tokens?) could
be measured. Getting that direction wrong silently double-bills or under-bills, so
nothing was written for them.

`openai` still lacks `cacheReadPer1M` on all 5 rows; `deepseek` still has its cached
count unread (`prompt_cache_hit_tokens`, a different field name from the shared
openai-compatible path). **They stay open, and they stay named as unverified rather
than reported as done.**
