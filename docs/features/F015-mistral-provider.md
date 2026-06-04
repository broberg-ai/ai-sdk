# F015 — Mistral Provider Adapter

> Add Mistral (La Plateforme) as a first-class provider so FysioDK Aalborg's new website can run its LLM calls through @broberg/ai-sdk. Tier: provider. Effort: S. Status: built (F015.1 + F015.2 done; live-verified).

## Motivation

FysioDK Aalborg's new website will use Mistral. Per the standing rule (all AI/LLM work goes through @broberg/ai-sdk — never a direct provider SDK), the SDK must speak Mistral before FysioDK can adopt it. Without it, FysioDK would have to hand-roll a Mistral client + its own cost tracking — exactly what the SDK exists to prevent.

## Solution

Mistral's La Plateforme exposes an OpenAI-compatible chat endpoint, so the adapter is the shared `makeOpenAICompatibleAdapter` core pointed at Mistral's base URL + key (the same pattern as DeepInfra/OpenRouter). Register it in the default provider registry, export it, and seed the pricing table for the common models so cost isn't logged as $0.

## Scope

### In scope
- `src/providers/mistral.ts` — `mistralAdapter({apiKey?, baseUrl?})` over `makeOpenAICompatibleAdapter` (name `mistral`, base `https://api.mistral.ai/v1`, Bearer auth, key from `MISTRAL_API_KEY`). Inherits chat + chatStream + tool-loop threading from the shared core.
- Registration in `src/providers/registry.ts` (`defaultProviders.mistral`) + export from `src/index.ts`.
- Mistral pricing entries in `src/cost/pricing.ts` (`mistral:` keys) for the common models, cross-referenced from OpenRouter's live catalogue.
- Tests: `src/providers/mistral.test.ts` (endpoint + Bearer + cost + registry).

### Out of scope
- A `mistral` tier in `DEFAULT_TIER_MAP`. Mistral is reached via `override: {provider:"mistral", model, transport:"http"}` (like gemini-direct) until a product reason makes it a default route.
- Mistral-specific capabilities beyond chat/stream: embeddings (`mistral-embed`), OCR (`mistral-ocr`), moderation, audio (`voxtral`), FIM/code-completion. Add per real demand.
- Confirming Mistral-DIRECT prices against mistral.ai/pricing. The seeded prices are OpenRouter-cross-referenced (Mistral's API returns no cost field) — good enough for cost tracking, flagged for reconfirmation.

## Architecture

### Adapter — `src/providers/mistral.ts`
```ts
export function mistralAdapter(config: { apiKey?: string; baseUrl?: string } = {}): ProviderAdapter {
  return makeOpenAICompatibleAdapter({
    name: "mistral",
    baseUrl: config.baseUrl ?? "https://api.mistral.ai/v1",
    apiKey: config.apiKey, // else MISTRAL_API_KEY (the shared core's ${NAME}_API_KEY rule)
  });
}
```
Posts to `${baseUrl}/chat/completions` with `Authorization: Bearer <key>`. chat + chatStream + tool threading come free from the shared core. `usage.provider = "mistral"`.

### Pricing — `src/cost/pricing.ts`
`mistral:` keys (USD per 1M), OpenRouter-cross-referenced 2026-06-04. NB: `mistral-medium-3.5` is a premium tier (**$1.5/$7.5**), well above `mistral-medium-3` ($0.4/$2). Seeded: large-latest/2512 (0.5/1.5), medium-latest/3.5 (1.5/7.5), medium-3 (0.4/2), small-latest/2603 (0.15/0.6), ministral-8b (0.15/0.15), ministral-3b (0.1/0.1), codestral-latest (0.3/0.9), open-mistral-nemo (0.02/0.03).

## Stories
- **F015.1** — Adapter + registry + export. (done)
- **F015.2** — Pricing entries + tests; live-verify chat/stream/cost with a real key. (done)

## Acceptance criteria
1. `createAI().chat({override:{provider:"mistral", model:"mistral-medium-3.5", transport:"http"}})` returns text from a live Mistral call. ✅ ("MISTRAL_OK", 26/5 tokens)
2. `chatStream` over the same override yields text deltas + a finish event. ✅ ("1 2 3 4 5", finish=stop)
3. A priced model logs non-zero `usage.costUsd` (no $0 under-count). ✅ ($0.000144 live; mistral-medium-3.5 1M+1M = $9.00 in test)
4. `mistralAdapter().name === "mistral"` and `defaultProviders.mistral` is registered. ✅
5. typecheck clean + full suite green. ✅ (184 tests)

## Dependencies
- `makeOpenAICompatibleAdapter` (`src/providers/openai-compatible.ts`) — exists, reused as-is.
- F014 catalogue research — used to cross-reference the seeded Mistral prices from OpenRouter.

## Rollout
Single-phase — additive provider, no breaking change. Ships in the next npm release (bundled per Christian's "next change" policy; currently main carries it unreleased alongside the F014/pricing fixes → v0.5.2). FysioDK installs that version and calls Mistral via the override pattern. Rollback = remove the registry entry (the adapter is inert unless called).

## Open Questions
- Which Mistral models will FysioDK actually use (drives which prices to keep sharp)? Their test app defaults to `mistral-medium-3.5`. See the model guide delivered alongside this plan.
- Confirm Mistral-direct prices vs the OpenRouter-cross-referenced seeds if exact cost accuracy matters for FysioDK billing.

## Effort estimate
**S** — ~0.5 day. Built in one session (adapter is a thin wrapper; most effort was pricing cross-reference + live verification).
