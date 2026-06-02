# F008 — Streaming chat (`ai.chatStream`) for agentic chat UIs

> Status: in progress · Epic · Priority: high
> Driven by: sanneandersen **Eir-chat** migration (F6.3). Consumer contract: sa intercom #2565.
> Scope decision (Christian, 2026-06-02): streaming MUST work correctly for **all** chat providers — not only OpenRouter.

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
  | { type: 'usage'; costUsd: number; model: string; usage: Usage }  // from provider usage
  | { type: 'finish'; reason: 'end_turn' | 'tool_calls' | 'length' | 'stop' }
  | { type: 'error'; message: string; status?: number }
```

**Provider coverage — streaming works for every chat-capable provider:**

| Provider | Adapter kind | Streaming source |
|---|---|---|
| openai | OpenAI-compatible | shared core (F8.2) |
| deepinfra | OpenAI-compatible | shared core (F8.2) |
| openrouter | OpenAI-compatible | shared core (F8.2) |
| anthropic | native `/v1/messages` | F8.4 (SSE: content_block_delta + tool_use accumulation) |
| gemini | native `streamGenerateContent` | F8.6 (SSE: candidates parts + functionCall) |
| fal | image-only | N/A (no chat) |

Tool-loop message threading — the normalized `Message` must round-trip a full multi-turn tool conversation through **both** `chat` and `chatStream`:
- assistant message carrying `toolCalls: ToolCall[]` → wire `tool_calls:[{id,type:'function',function:{name,arguments}}]`
- `tool`-role message carrying `toolCallId` + string content → wire `{role:'tool',tool_call_id,content}`

The SDK's **public** message shape stays normalized (`Message.toolCalls` / `Message.toolCallId`); adapters translate to each provider's wire form. (Today `toOpenAIMessage` serialized `tool_call_id` but NOT assistant `toolCalls` → a real gap in `chat` too, fixed in F8.3.)

Fallback in streaming: the existing fallback-chain semantics (eligible 429/5xx/network/timeout → next tier; hard 4xx bubbles up) apply **before the stream starts** (and if the connection drops before the first token). Same fallback array as `ai.chat`.

### Non-goals

- **Not** an agent runtime. `chatStream` is a per-turn streaming engine; the caller owns the tool-loop orchestration (same boundary drawn with trail, #2548).
- **No** mid-stream fallback after tokens have already been emitted (can't un-emit deltas) — fallback is pre-first-token only.
- **No** streaming for translate/vision/contract capabilities in v1 — chat only (Eir is the only streaming consumer today).

## Architecture

```
ai.chatStream(input)
  └─ resolve spec (tier/override/fallback)  ── pre-stream fallback (F8.1)
       └─ adapter.chatStream(req): AsyncIterable<ChatStreamEvent>
            └─ streamTransport(req)  ── fetch + ReadableStream + SSE line parser (F8.1)
                 └─ provider SSE → ChatStreamEvent mapping
                      ├─ OpenAI-compatible (F8.2)  ← openrouter/openai/deepinfra
                      ├─ Anthropic-direct (F8.4)
                      └─ Gemini-direct   (F8.6)
```

- **`streamTransport`** (`src/transport/stream.ts`): like `httpTransport` but returns the response body as an async-iterable of parsed SSE `data:` events instead of awaiting `.json()`. Pure fetch, Node+Bun safe.
- **`ChatStreamEvent`** — single-source discriminated-union type in `src/types.ts` (output types are plain here; only inputs are Zod).
- **`ProviderAdapter.chatStream?(req): AsyncIterable<ChatStreamEvent>`** — optional, mirrors `chat?`. Absence → typed "provider X does not support streaming".
- **OpenAI-compatible streaming** (F8.2): `stream:true` + `stream_options:{include_usage:true}`; parse `choices[].delta.content` → text, accumulate `delta.tool_calls[]` → complete `tool_call`, map `finish_reason`, final `usage` chunk → `usage` event.
- **Anthropic-direct streaming** (F8.4): `/v1/messages` `stream:true`; `content_block_delta(text_delta)` → text, `input_json_delta` for tool_use blocks → tool_call, `message_delta` usage → usage event.
- **Gemini-direct streaming** (F8.6): `streamGenerateContent?alt=sse`; candidate `parts[].text` → text, `parts[].functionCall` → tool_call, `usageMetadata` → usage event.
- **Pre-stream fallback** (F8.1): first-token (or pre-connect) error triggers the next fallback spec; once a `text`/`tool_call` event is emitted, errors surface as an `error` event (no silent re-route).

## Stories

| # | Title | Gist |
|---|---|---|
| F8.1 | Streaming transport + `ai.chatStream` facade + event contract | ✅ `streamTransport` (SSE), `ChatStreamEvent`, `ai.chatStream()` with pre-stream fallback |
| F8.2 | OpenAI-compatible streaming adapter | ✅ deltas + tool_call accumulation + usage + finish. openrouter/openai/deepinfra |
| F8.3 | Tool-threading message serialization | assistant `toolCalls` → wire `tool_calls[]` for `chat` AND `chatStream` |
| F8.4 | Anthropic-direct SSE streaming | `/v1/messages` stream: content_block_delta + tool_use + message_delta usage |
| F8.6 | Gemini-direct SSE streaming | `streamGenerateContent?alt=sse`: parts text + functionCall + usageMetadata |
| F8.5 | Publish + notify sa + live e2e | bump+tag+publish, ping sa, verify Eir streams end-to-end through the SDK |

## Dependencies

- Builds on F2 (transport), F4 (adapters/tools), F3 (cost/fallback). No new deps — pure `fetch` + `ReadableStream`.
- Bundled npm minor also carries F009 (JSON mode) + F010 (OpenRouter ground-truth cost).
- Consumer: sanneandersen Eir (F6.3) wires it the moment F8.5 publishes.

## Rollout

F8.1 → F8.2 → F8.3 unblock Eir (OpenRouter); F8.4 + F8.6 bring anthropic + gemini to parity so streaming is correct on every provider; publish at F8.5. Live verification = a real Eir streamed turn (text deltas + one tool-loop round) observed through the SDK, cost landing in upmetrics agent_runs under `sanneandersen`.
