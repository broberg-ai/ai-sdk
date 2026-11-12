# F090 — ai.chat kan afbrydes: `timeoutMs` og `signal`

> Gap fra mailworker (mailworker-F004.9) via components #50171, 12/11 2026. High. Effort S.

## Summary
`ai.chat` (og `ai.chatStream`) får `timeoutMs` og `signal` (AbortSignal). Begge afbryder SELVE fetch'en mod udbyderen — forbindelsen lukkes — i stedet for kun at holde op med at vente. En afbrydelse giver en navngiven fejl (`AiTimeoutError` / `AiAbortError`) og en række i omkostningsloggen som ethvert andet fejlet kald.

## Motivation
Målt af mailworker 12/11: deres ugentlige kørsel stod 36+ minutter på ét Mistral-kald — én åben forbindelse til api.mistral.ai, 0 % CPU — og hænger for evigt. launchd kan ikke starte næste uges kørsel mens den hænger. SDK'en sender i dag ingen AbortSignal til fetch, så et hængende svar kan kun undgås ved at kalderen opgiver at vente (og så kan forbindelsen og regningen stadig køre videre). F088.5 (second opinion) har samme mangel og dokumenterer den som forbehold.

## Reuse
- Dette ER `@broberg/ai-sdk`; ændringen er i den fælles `httpTransport` og de fire adaptere der bruger den. Ingen ny pakke.
- Discovery: ingen `@broberg/*`-pakke ejer timeout for LLM-kald.

## Design
None — no visual surface.

## Scope
### In scope
- `TransportRequest.signal` → sendes til fetch i `httpTransport`.
- `ChatRequest.signal` → openai-compatible (Mistral/DeepSeek/OpenRouter/…), openai, anthropic, gemini sender det videre.
- `ai.chat` / `ai.chatStream` input: `timeoutMs?: number`, `signal?: AbortSignal`; kombineres med `AbortSignal.any`.
- Navngivne fejl: `AiTimeoutError` (name `"AiTimeoutError"`, med `timeoutMs`) og `AiAbortError` — eksporteret.
- Fejlen går gennem den eksisterende fejl-sti i `runCapability`, så omkostningsloggen får en række.
- Docs + release + svar til mailworker.
### Out of scope
- Standard-timeout for alle kald (adfærdsændring for alle apps — kan blive et senere kort).
- Timeout på andre capabilities (vision, image, …) — næste kort hvis efterspurgt.
- `ai.secondOpinion` flyttes over på den rigtige afbrydelse i samme release (lille, samme mekanisme).

## Architecture
```ts
await ai.chat({ prompt, tier: "smart", timeoutMs: 120_000 });
await ai.chat({ prompt, signal: controller.signal });
// → throws AiTimeoutError / AiAbortError; fetch is aborted, socket closed
```
I `client.chat`: `const sig = combine(input.signal, input.timeoutMs)` → sendes ned i `adapter.chat({ …, signal })` → `httpTransport({ …, signal })` → `fetch(url, { signal })`. En `AbortError` fra fetch oversættes til den navngivne fejl.

## Stories
- **F090.1** — timeoutMs + signal på ai.chat/chatStream, gennem transport og adaptere, tests, docs, release, svar til mailworker.

## Acceptance criteria
1. `ai.chat({ timeoutMs: 50 })` mod en fetch der aldrig svarer kaster `AiTimeoutError` efter ~50 ms, OG fetch'ens signal er aborted (bevis: fake fetch ser `signal.aborted === true`) — unit-test.
2. `ai.chat({ signal })` + `controller.abort()` kaster `AiAbortError`, fetch'ens signal aborted — unit-test.
3. Uden timeoutMs/signal ændres intet (eksisterende suite grøn).
4. Fejlen går i omkostningsloggen (cost-sink får en fejl-række) — unit-test.
5. Release på npm; mailworker og components informeret.

## Dependencies
None.

## Rollout
Additivt (nye valgfrie felter). Minor-bump.

## Open Questions
1. Skal der på sigt være en standard-timeout for alle chat-kald? Ikke i denne omgang.

## Effort estimate
**S** — ½ dag.
