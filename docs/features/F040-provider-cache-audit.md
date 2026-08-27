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
| **gemini** | not needed — implicit | ✅ (F040.1) | 2/2 |
| **vertex** | not needed — implicit | ✅ (F040.1) | 2/2 |
| **openrouter** | not needed — upstream | ✅ **measured complete** | n/a — ground-truth `usage.cost` |
| **openai** | not needed — automatic | ✅ **measured** (F040.2) | 2/2 chat models (embeddings do not cache) |
| **deepseek** (direct) | not needed — automatic | ❓ unverified — no key | **0/2** |

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


## The openrouter route is complete — measured 2026-08-27, and it corrects this doc

The table above originally said openrouter's cached-token visibility was missing. It is
not. Measured through `ai.chat` against `deepseek/deepseek-v4-flash` via OpenRouter:

```
call 1: input=1417  cached=8192  sum=9609  cost=$0.00085844
call 2: input= 137  cached=9472  sum=9609  cost=$0.00069204
call 3: input= 137  cached=9472  sum=9609  cost=$0.00069204
call 4: input=1417  cached=8192  sum=9609  cost=$0.00085844
```

The split is read, the subtraction is right (the halves always sum to the reported
9,609), and the cost is OpenRouter's own ground-truth figure rather than our estimate.
Nothing to build. It arrived for free with F039's openai-compatible read-back.

**Note the shape of the saving: it fluctuates.** 8,192 cached on some calls, 9,472 on
others, on an identical prefix. Another reason a spend cap must not assume a cache
discount it has not yet observed.

### Two corrections to my own measurement, both the same error

**One.** I first reported "cached tokens NOT visible through OpenRouter" after 3 calls
showing `cached: 0`. Calls 5 and 6 showed 8,192. **Three calls was not enough** — the
same sample-size mistake that made me wrongly declare Gemini's `systemInstruction`
uncacheable an hour earlier, and the same one I had spent the day warning three peers
about.

**Two.** My negative control was invalid. I compared the cost of a fresh prefix against
a warm one — but the fresh prefix was 6,409 tokens against 9,609, so the two costs were
never comparable. A control that varies two things at once measures neither.

## What is genuinely left

- **openai** — the read-back is in place (it is OpenAI's own field shape), but there is
  no `cacheReadPer1M` on any of the 5 rows, so cached tokens fall back to the full input
  rate and our reported cost stays too high. Needs a key to verify before writing a rate.
- **deepseek direct** — DeepSeek's native API documents `prompt_cache_hit_tokens`, a
  different name from the shared path's `prompt_tokens_details.cached_tokens`. Whether
  it ALSO returns the OpenAI-shaped field is unverified. **Measuring it through
  OpenRouter cannot answer this** — OpenRouter normalises the usage object, so that
  route measures OpenRouter, not the deepseek adapter. Needs a direct key, which does
  not exist.


## F040.2 — OpenAI, measured with the key from the vault

Christian put an OpenAI key in the project vault (`01a044f5-…`); it was fetched
straight into the gitignored `.env` by a script, so the value never passed through a
context.

Measured against the real API, `gpt-4o-mini`, identical 7,615-token prefix:

```
call 1: prompt=7615  cached=   0
call 2: prompt=7615  cached=7552
call 3: prompt=7615  cached=7552
call 4: prompt=7615  cached=7552
call 5: prompt=7615  cached=7552
```

`prompt_tokens` **includes** the cached ones, and the shared openai-compatible path
already subtracts them — so the read-back needed no change. Live through `ai.chat`:

```
input=63  cached=7552  sum=7615  cost=$0.00057705
```

**OpenAI's caching is far more reliable than Gemini's:** 4 hits out of 5 calls, versus
1 out of 6 for Gemini on the same kind of prefix. Worth knowing before anyone builds a
spend cap that treats "cached" as one behaviour.

### The rate is 50%, and that is the finding

$1.25 vs $2.50 (gpt-4o) and $0.075 vs $0.15 (gpt-4o-mini), read from
`developers.openai.com/api/docs/pricing` on 2026-08-27.

**Not the 10% Mistral and Gemini charge.** Carrying one uniform cross-provider
discount across would have understated OpenAI's cost by 4× on the cached half. A test
now pins the two ratios apart so a later edit cannot quietly converge them.

**The embedding models get NO cached row on purpose.** OpenAI's page lists no cached
rate for them — embeddings do not cache — so an absent row here is a decision, and a
test asserts it stays absent. Inventing one is the exact error class this card exists
to close.

### A trap worth recording: an EMPTY env var defeats `??=`

The live probe first failed with "API key not set" although the key was in `.env`. The
shell already exported `OPENAI_API_KEY=""`, and `??=` only assigns on null/undefined —
an empty string is neither. The adapter itself behaves correctly (`if (!apiKey) throw`),
but any loader using `??=` will silently prefer an empty shell variable over a real
value in a file. Use a falsy check, not a nullish one.

## What is left

Only **deepseek direct**. Its native API documents `prompt_cache_hit_tokens`, a
different name from the shared path's field, and there is no direct DeepSeek key —
measuring it through OpenRouter measures OpenRouter, not the deepseek adapter. It stays
open and named as unverified.
