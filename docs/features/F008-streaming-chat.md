# F008 — Streaming chat (`ai.chatStream`) for agentic chat UIs

> Status: planned · Epic · Priority: high
> Driven by: sanneandersen **Eir-chat** migration (F6.3). Consumer contract: sa intercom #2565.

## Motivation

The standing policy is that **all** of Christian's AI/LLM work goes through `@broberg/ai-sdk`. The one capability the facade lacks is **token streaming**, which blocks migrating the most visible AI surface in the portfolio: sanneandersen's **Eir** assistant.

Eir is an *agentic streaming* chat: each turn it streams text-deltas live to the browser over SSE and may emit `tool_calls`; the caller orchestrates the tool-loop (chat → stream text+tool_calls → exec tools → append `assistant(tool_calls)` + `tool(result)` messages → chat again). Today it is hand-rolled OpenRouter SSE with a gemini→sonnet fallback — exactly the kind of bespoke plumbing the SDK exists to replace.

`ai.chat` is single-shot and returns a resolved `{text, toolCalls, usage}` — it cannot stream. This epic adds a streaming sibling so Eir migrates **without UX regression**.

## Scope

`ai.chatStream(input): AsyncIterable<ChatStreamEvent>` — same input shape as `ai.chat` (messages, system, tools, tier/override/fallback, maxTokens, temperature, purpose). Event contract (from the consumer, sa #2565):

```ts
type ChatStreamEvent =
  | { type: 'text'; delta: string }                       // live token deltas
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> } // emitted COMPLETE (accumulated)
  | { type: 'usage'; costUsd: number; model: string; usage: Usage }  // from provider usage (include_usage)
  | { type: 'finish'; reason: 'end_turn' | 'tool_calls' | 'length' | 'stop' }
  | { type: 'error'; message: string; status?: number }
```

Tool-loop message threading — the normalized `Message` must round-trip a full multi-turn tool conversation through **both** `chat` and `chatStream`:
- assistant message carrying `toolCalls: ToolCall[]` → wire `tool_calls:[{id,type:'function',function:{name,arguments}}]`
- `tool`-role message carrying `toolCallId` + string content → wire `{role:'tool',tool_call_id,content}`

The SDK's **public** message shape stays normalized (`Message.toolCalls` / `Message.toolCallId`); adapters translate to each provider's wire form. (Today `toOpenAIMessage` serializes `tool_call_id` but NOT assistant `toolCalls` → a real gap in `chat` too, fixed here.)

Fallback in streaming: the existing fallback-chain semantics (eligible 429/5xx/network/timeout → next tier; hard 4xx bubbles up) apply **before the stream starts** (and if the connection drops before the first token). Same fallback array as `ai.chat`.

### Non-goals

- **Not** an agent runtime. `chatStream` is a per-turn streaming engine; the caller owns the tool-loop orchestration (same boundary drawn with trail, #2548).
- **No** mid-stream fallback after tokens have already been emitted (can't un-emit deltas) — fallback is pre-first-token only.
- **No** streaming for translate/vision/contract capabilities in v1 — chat only (Eir is the only streaming consumer today).
- Anthropic-**direct** streaming is in-scope but **deferred to F8.4** (parity); Eir uses OpenRouter, so the OpenAI-compatible path (F8.2) unblocks it.

## Architecture

```
ai.chatStream(input)
  └─ resolve spec (tier/override/fallback)  ── pre-stream fallback (F8.1)
       └─ adapter.chatStream(req): AsyncIterable<ChatStreamEvent>
            └─ streamTransport(req)  ── fetch + ReadableStream + SSE line parser (F8.1)
                 └─ provider SSE → ChatStreamEvent mapping
                      ├─ OpenAI-compatible (F8.2)  ← OpenRouter/OpenAI/deepinfra/gemini
                      └─ Anthropic-direct (F8.4, follow-up)
```

- **`streamTransport`** (new, `src/transport/stream.ts`): like `httpTransport` but returns the response body as an async-iterable of parsed SSE `data:` events instead of awaiting `.json()`. Pure fetch, Node+Bun safe.
- **`ChatStreamEvent`** type + Zod (`src/schema/inputs.ts` or a new `stream.ts` schema) — single source.
- **`ProviderAdapter.chatStream?(req): AsyncIterable<ChatStreamEvent>`** — optional, mirrors `chat?`. Absence → typed "provider X does not support streaming".
- **OpenAI-compatible streaming** (F8.2): set `stream:true` + `stream_options:{include_usage:true}`; parse `choices[].delta.content` → text events, accumulate `delta.tool_calls[]` (index-keyed, args string concatenated) → emit complete `tool_call` on finish, map `finish_reason`, read final `usage` chunk → `usage` event with computed `costUsd`.
- **Tool-threading serialization** (F8.3): extend `toOpenAIMessage` (and the anthropic equivalent) to emit assistant `tool_calls[]`; verify `chat` + `chatStream` both thread a 2-turn tool conversation.
- **Pre-stream fallback** (F8.1): wrap the adapter call so the first-token (or pre-connect error) triggers the next fallback spec; once a `text` event is emitted, errors surface as an `error` event (no silent re-route).

## Stories

| # | Title | Gist |
|---|---|---|
| F8.1 | Streaming transport + `ai.chatStream` facade + event contract | `streamTransport` (SSE), `ChatStreamEvent` types+Zod, `ai.chatStream()` with pre-stream fallback + `chatStream?` on the adapter contract |
| F8.2 | OpenAI-compatible streaming adapter | text deltas + tool_call accumulation + usage (include_usage) + finish/error mapping. **Unblocks Eir (OpenRouter)** |
| F8.3 | Tool-threading message serialization | assistant `toolCalls` → wire `tool_calls[]` + `tool`-role round-trip, for `chat` AND `chatStream` |
| F8.4 | Anthropic-direct SSE streaming (parity) | `/v1/messages` stream: content_block_delta + tool_use accumulation + message_delta usage. Follow-up — not on Eir's critical path |
| F8.5 | Publish + notify sa + live e2e | bump+tag+publish, ping sa with the API + version, verify Eir streams end-to-end through the SDK |

## Dependencies

- Builds on F2 (transport), F4 (adapters/tools), F3 (cost/fallback). No new deps — pure `fetch` + `ReadableStream`.
- Consumer: sanneandersen Eir (F6.3) wires it the moment F8.5 publishes.

## Rollout

F8.1 → F8.2 → F8.3 unblock Eir; publish at F8.5. F8.4 (anthropic-direct) lands after as parity. Live verification = a real Eir streamed turn (text deltas + one tool-loop round) observed through the SDK, cost landing in upmetrics agent_runs under `sanneandersen`.
