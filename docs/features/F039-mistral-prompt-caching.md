# F039 — Prompt caching on Mistral: we drop the parameter that makes it work

> **Status: shipped in 0.30.0, 2026-08-27.** Raised by cms, who asked a question we
> could not answer from memory and then refused to accept the first answer.

## The measurement, and why the first one was not enough

cms asked whether Mistral caches prompts. First measurement: two identical calls,
2,411-token shared prefix, `cached_tokens: 0` both times. That looked like an answer.

**cms rejected it, correctly.** It showed caching did not *happen* on that route — not
that Mistral *cannot*. And the field `prompt_tokens_details.cached_tokens` exists in
Mistral's response, which means Mistral has the concept. A field that is always zero
rarely exists without a reason. They named three futures that lead to different actions:

| | | action |
|---|---|---|
| (a) | Mistral does not cache on this model | nothing to do, the field is legacy |
| (b) | it caches only above a prefix threshold | send more, measure again |
| (c) | it requires an explicit opt-in | **our adapter is the bug, not the vendor** |

That taxonomy is the contribution. A yes/no answer would have closed the question at
(a) and left the money on the table.

## What the sweep showed

Ruled out (b) first — same prefix, doubled repeatedly, `mistral-large-latest`:

```
prompt =  8,810 tokens | call 1 cached=0 | call 2 cached=0
prompt = 26,410 tokens | call 1 cached=0 | call 2 cached=0
prompt = 57,210 tokens | call 1 cached=0 | call 2 cached=0
```

Not a size threshold. Then (c), with `prompt_cache_key` from Mistral's docs:

```
WITHOUT the key:  call 1 cached=0     call 2 cached=0
WITH the key:     call 1 cached=0     call 2 cached=8,784     call 3 cached=8,784
```

**8,784 of 8,810 tokens served from cache.** Mistral caches. We never ask.

## Why this matters more than one repo's bill

Every default tier in the fleet resolves to Mistral (F030). Cached prompt tokens bill
at **10% of the input rate**. cms sends a fixed 6,619-token system instruction on every
chat message — it grows with the site schema, not the conversation, so it is the same
prefix every time, which is the best possible caching case that exists. components is
building `@broberg/chat` on the same path for everyone.

## Scope

- `promptCacheKey` on the chat request, forwarded as `prompt_cache_key` on the
  openai-compatible body (Mistral's own SDK supports it; ours dropped it).
- Read `prompt_tokens_details.cached_tokens` back into `usage.cacheReadTokens`.
- `cacheReadPer1M` on every Mistral pricing row at 10% of its input rate.

**Both halves or neither.** Sending the key without reading the cached count means the
saving happens while the cost we report stays wrong — a confident wrong number, which
this repo has spent two days establishing is worse than no number.

**And the subtraction that prevents double-billing.** Mistral's `prompt_tokens`
INCLUDES the cached ones, while `computeCost` adds `cacheReadTokens` ON TOP of
`inputTokens`. Billing the raw figure would charge the cached prefix twice — once at
full rate and once at the cache rate.

### Non-goals

- No automatic key. A cache key is an application-level identity (a conversation,
  a session); inventing one inside the SDK would either collide across tenants or
  never hit. The caller knows what "the same conversation" means; we do not.
- No caching for other providers in v1.

## Reuse

Checked before planning: no `@broberg/*` package owns LLM transport — this repo is the
fleet's AI primitive. Nothing external to reuse.

## Live proof (not a mock)

End-to-end through `ai.chat`, real Mistral API, `costSink: null`:

```
without a key   input=8810  cached=   0  cost=$0.004411
with a key #1   input=8810  cached=   0  cost=$0.004411
with a key #2   input=  26  cached=8784  cost=$0.000458   ← 90% cheaper
```

## Known ambiguity, documented rather than hidden

`freshUsage` defaults `cacheReadTokens` to 0 for **every** provider, so `0` means
both "no cache hit" and "this provider never reports caching". Billing is correct
either way — nothing is charged at the cache rate — but a caller cannot ask "did
caching happen?" from that field alone. Left as-is: narrowing the type would change
a field every adapter writes, for a distinction only Mistral currently makes. If a
consumer ever needs it, that is the moment to add a separate signal, not now.

The AC that demanded `undefined` was **amended down before implementation finished**,
with the reason recorded on the card rather than the requirement quietly dropped.
