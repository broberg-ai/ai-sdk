# F4 — Provider breadth: OpenAI, Gemini, DeepInfra, OpenRouter (MiniMax)

## Role
Cover all currently-used providers behind the `ProviderAdapter` interface defined in F2.

## Task
Implement real adapters for OpenAI, Google Gemini, DeepInfra, and OpenRouter (including MiniMax M2.7). Each adapter returns accurate token counts and `costUsd` from the F3 pricing table, and normalizes tool/function-calling to the single SDK-level contract.

## Context
**v1 provider scope = all providers currently used across the portfolio repos** (from the F1 inventory). fal.ai is handled in F5 (image capability), not here.

The biggest cross-provider pain is **tool/function-calling** — each provider has its own schema. The SDK normalizes this to a single `Tool` type so callers never see provider-specific formats.

**Dependency:** F2 (ProviderAdapter interface), F3 (pricing + Usage), F4.5 (tool contract — implement this story first so other adapters can import it).

## Non-goals
- No fal.ai adapter here (F5)
- No Anthropic adapter here (F2 covers the stubs; Anthropic via subprocess is F2.4)
- No streaming in v1 — all calls are request/response

## Stories

| Story | Title |
|---|---|
| F4.1 | OpenAI adapter |
| F4.2 | Google Gemini adapter |
| F4.3 | DeepInfra adapter |
| F4.4 | OpenRouter adapter (+ MiniMax M2.7) |
| F4.5 | Normalized tool/function-calling contract |

## Acceptance criteria
1. OpenAI, Gemini, DeepInfra, OpenRouter adapters implement `ProviderAdapter`
2. Each adapter returns accurate token counts and `costUsd` from the F3 pricing table
3. Tool/function-calling normalized to a single SDK-level `Tool` contract across all adapters
4. MiniMax M2.7 reachable via the OpenRouter adapter
