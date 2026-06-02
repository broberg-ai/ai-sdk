# F009 — Structured output (JSON mode) for `ai.chat`

> Status: planned · Epic · Priority: medium
> Surfaced by: sanneandersen migration (sa intercom #2573). Ships with F008 streaming.

## Motivation

sanneandersen's **ai-author** needs guaranteed JSON output. Pre-migration it used OpenRouter's `response_format:{type:'json_object'}`. `ai.chat` doesn't expose that, so sa added a defensive markdown-fence-stripping work-around at the call-site — exactly the hand-rolled plumbing the standing policy says to fold INTO the SDK instead. This epic adds first-class JSON mode so the work-around is removed.

## Scope

- Add `responseFormat?: 'json' | 'text'` to `chatInputSchema` (Zod single source) → `ChatInput` derives it.
- Thread it through to the OpenAI-compatible adapter (`ChatRequest` gains an optional `responseFormat`): when `'json'`, set `response_format:{type:'json_object'}` on the request body — for BOTH `chat` and `chatStream`.
- Covers OpenRouter / OpenAI / DeepInfra (shared core). sa is on OpenRouter → 1:1.

### Non-goals
- Anthropic-direct: no `response_format:json_object` equivalent. Out of scope for v1 — anthropic-direct callers keep prompting for JSON.
- No JSON Schema-constrained structured-outputs grammar in v1 — just free-form `json_object`, which is what the consumer needs.

## Stories

| # | Title | Gist |
|---|---|---|
| F9.1 | responseFormat:'json' on chat + chatStream | Zod field + ChatRequest threading + OpenAI-compatible `response_format` wiring + test |

## Rollout

Bundled into the same npm minor as F008 (F8.5 publish). sa removes its fence-stripping work-around and switches ai-author to `responseFormat:'json'` the moment it lands.
