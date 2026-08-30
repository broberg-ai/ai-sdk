# F043 — Four defects consumers measured in the shipped 0.34.0

> **Status: fixed, pending release.** All four were found by CONSUMERS reading or
> running the published tarball — none by us, and none by a test we already had.
>
> **Process note, stated rather than buried:** board-before-code was not followed. The
> fixes were written before this card existed. The one sanctioned exception (F180.6)
> covers a defect the OWNER reports while using the product; a peer session's report
> explicitly does not qualify, and a peer cannot authorise the shortcut any more than
> it can authorise a destructive action.

## What links all four

Three of the four are the same shape, and components named it before we did:
**a missing value degrading into something that does not look like a missing value.**

| | the missing thing | what it looked like instead |
|---|---|---|
| F043.1 | `promptCacheKey` on the streaming path | a normal, working, full-price call |
| F043.2 | `model` on a provider-only override | "Anthropic is down" (a 404 from the wrong endpoint) |
| F043.3 | a JSON body on an error response | `TypeError: … reading 'slice'`, pointing nowhere near the 502 |
| F043.4 | `arguments` on a tool call spelled `args` | a Zod `Required` failure in production |

The fourth is a naming disagreement rather than a missing value, but it fails the same
way: silently, at the boundary, in someone else's repo.

---

## F043.1 — The prompt cache never reached `chatStream`

Measured independently by **components** (#24153) and **sanne** (#24154) in
`npm pack @broberg/ai-sdk@0.34.0`. `prompt_cache_key` appears exactly ONCE in
`dist/index.js` — inside `adapter.chat`. Two separate drops:

1. **The facade** passed `promptCacheKey`/`promptCache` to `adapter.chat` and not to
   `adapter.chatStream`.
2. **The adapter** built a second, separate body in `chatStream` that never called
   `autoCacheKey`.

**Anyone streaming got no cache at all — not less, none.** And it is not guessable from
outside: the type says `chatStream?(req: ChatRequest)` with the comment *"Same request
shape as chat"*, and `ChatRequest` carries both fields. A silent omission behind a
contract that says yes.

The damage lands exactly where the gain is largest. A chat UI streams every turn and
repeats the same system prompt each time; sanne's Eir sends ~6,000 tokens of system
prompt on every call, at least two calls per message, on a live customer-facing site.
Our own measured numbers (8,810 tokens: $0.004411 → $0.000458, 90% off) applied to the
one call shape that could never reach them.

**The fix is ONE body builder, not a copied block.** Copying the missing lines across
would close this instance and leave the next added field free to drift the same way —
which is precisely how this happened. `buildChatBody()` is now the only place a chat
body is constructed; `chatStream` adds `stream` + `stream_options` and nothing else,
and a test asserts the two bodies are otherwise identical.

## F043.2 — A provider-only override sent the tier's model to the wrong provider

Measured by **coverletter** via components (#24150), 4/4 with distinct request ids:

```
ai.chat({ tier: 'cheap', override: { provider: 'anthropic' } })
  → anthropic 404 {"type":"not_found_error","message":"model: mistral-small-latest"}
```

`resolveTier` merged `{...base, ...override}`, so a provider-only override kept the
tier's model. It **failed closed**, which is the good half. The bad half is who hits it:
`{ provider }` alone is the natural thing to write, and it was the exact advice given to
a repo working around a missing Mistral key — so the escape hatch from one problem
produced an error that reads as "Anthropic is down", and they spent minutes suspecting
their own API key.

**We refuse rather than re-resolve.** Picking a model for the new provider would make
the SDK take a PRICE decision on the caller's behalf, and the bill would be the only
place that decision was visible — the class of silent choice this repo has spent weeks
removing. The error names the fix.

One ordering detail: a provider the client has never heard of is a TYPO, and
`no provider adapter registered for "nope"` is the useful thing to say about it. The
mismatch guard steps aside for an unregistered provider and lets the registry answer.

## F043.3 — The error handler crashed on a non-JSON error body

Reported by **cms** via components (#24152) as a one-off they could not reproduce:
`TypeError: Cannot read properties of undefined (reading 'slice')` out of an `ai.chat`
used as a conversation summariser. They had already excluded both their own halves
line by line before filing it.

Found in four adapters (anthropic, openai, openai-compatible, gemini):

```ts
throw new Error(`${name} ${res.status}: ${JSON.stringify(res.json).slice(0, 300)}`);
```

`httpTransport` sets `json` to `undefined` when the body will not parse, and
**`JSON.stringify(undefined)` returns `undefined`, not a string.** So on an HTML 502
from a gateway, a proxy timeout page, or an empty body, the ERROR HANDLER threw —
replacing a useful `mistral 502: <gateway page>` with a TypeError that pointed at our
own code instead of the outage.

It is not rare behaviour; it is a rare RESPONSE. That is why five subsequent runs were
clean and why it looked like noise.

Fixed with one `errorBody()` in the transport that cannot throw — undefined/null →
`"(no body)"`, a string passes through, a circular payload degrades. Proven by a test
that drives a real 502 with an HTML body through the adapter, and mutation-checked by
restoring the old expression (goes red).

## F043.4 — `arguments` vs `args`

`@broberg/ai-sdk` emits `ToolCall.arguments`; `@broberg/chat` uses `args` consistently
across `ModelEvent`, `ChatFrame` and `ChatTool.run`. cms bridges the two and took a
production failure minutes after fixing an unrelated one in the same file:

```
invalid_type · expected object · received undefined
path: messages.1.toolCalls.0.arguments · "Required"
```

Their rename lived inside a workaround; when the workaround became unnecessary and was
deleted, the rename went with it. That is their bug — and it is a bug that can only
exist because two of our packages disagree about one word.

**We accept both; we do not rename, and neither do they.** components' reasoning holds:
`args` is internally consistent in `@broberg/chat`, so renaming there would trade one
inconsistency for a larger one plus a break for a repo that adopted the same day.
Accepting is additive and cannot break anyone. `arguments` stays canonical and is what
we always EMIT; `ToolCallLike` is what we accept back in a message history.

> Noted, not changed: our own stream events already yield `args` while `ChatResult`
> yields `arguments`. That internal split is probably where the confusion started. It
> is a breaking change to align, so it is left alone and written down here instead.

## Reuse

All four are defects inside this package's own surface — no shared `@broberg/*`
package owns provider transport, tier routing, or tool-call normalisation. Nothing to
reuse; the fixes belong here by definition.

## Stories

| | |
|---|---|
| **F043.1** | One shared chat-body builder, so streaming caches and cannot drift again |
| **F043.2** | Refuse a provider-only override instead of posting a foreign model |
| **F043.3** | An error formatter that cannot itself throw |
| **F043.4** | Accept `args` as well as `arguments` on an incoming tool call |

## Owed back

- **components + sanne** — the version, phrased as a dated measurement.
- **sanne** has parked their 0.10.3 → 0.34.x upgrade (F095.1) on this landing, and
  asked a fair question we should answer directly: *why did the streaming path build
  its own body at all?* No reason. It is one builder now.
- **Christian** — the one thing that is his and not ours: is there a FLEET Mistral
  account, or does each repo provision its own? Every new adopter now hits a missing
  `MISTRAL_API_KEY` on the default route, and the natural workaround is an
  `override:{provider:'anthropic'}` nobody rolls back — which would turn F030's EU
  default into a Claude default, one adoption at a time, with no one deciding it.
