# F030 — Phase out the Anthropic API default route → Mistral EU (primary) + DeepSeek V4 Pro (secondary)

> Tier: routing/provider/policy. Effort: M. Status: PLANNED (plan-first board contract — no code until greenlit). Christian-order via components (#56).

## Motivation

`ANTHROPIC_API_KEY` is being **globally removed** (it leaked ~$155/mo for 15 days and is already DEAD on M1 — see [[anthropic-api-key-removed]]). But ai-sdk's `DEFAULT_TIER_MAP` still routes **4 of 7 default tiers to Anthropic** (`fast`→claude-haiku, `smart`→claude-sonnet, `powerful`→claude-opus, `vision`→claude-sonnet). So the default **server-side cloud route now hits a dead/removed key → every default `ai.chat`/`ai.vision` fails** for consumers. ai-sdk is the fleet chokepoint, so the fix lands here.

**Critical scope nuance (do NOT over-correct):** Claude Code — the Max-plan *coding tool* ($0) — is NOT affected. This phase-out is ONLY ai-sdk's programmatic server-side cloud-API route. Claude stays reachable as a **non-default** quality fallback for **non-PII** via OpenRouter (`override:{provider:"openrouter", model:"anthropic/claude-…"}`); the default cloud route just must not hit Anthropic Console directly.

## Solution

1. **Re-point `DEFAULT_TIER_MAP`** so the Anthropic-bound tiers default to **Mistral EU** (Paris, Schrems II-safe — already the `cheap`-tier discipline).
2. **Build a dedicated `deepseekAdapter`** (DeepSeek direct API, OpenAI-compatible) as the **secondary** route — non-PII only (CN-hosted, not GDPR-safe).
3. **Keep the `anthropicAdapter`** in the registry (un-removed) — reachable via override for non-PII quality; never the default.
4. **GDPR guard:** PII/personal data ALWAYS → Mistral EU. The DeepSeek (CN) + Claude-via-OpenRouter (US) secondaries are **non-PII only** and are NOT a blind auto-fallback (a silent Mistral→DeepSeek fallback would leak PII to CN — explicitly avoided).

## Scope

### In scope
- `src/routing/tier-map.ts` — re-point `DEFAULT_TIER_MAP`:
  - `fast` → `mistral-small-latest` (was claude-haiku)
  - `smart` → `mistral-large-latest` (was claude-sonnet)
  - `powerful` → `mistral-large-latest` (was claude-opus) *(Mistral's frontier; see Open Q)*
  - `vision` → `mistral-small-latest` (vision-capable — verify) (was claude-sonnet)
  - `cheap` → `mistral-small-latest` (unchanged), `embedding`/`video` unchanged (NOT Anthropic — see Open Q).
- `src/providers/deepseek.ts` — `deepseekAdapter({ apiKey?, baseUrl? })` on `makeOpenAICompatibleAdapter` (`name:"deepseek"` → key `DEEPSEEK_API_KEY`, base `https://api.deepseek.com/v1`, ground-truth cost if returned). Register in `registry.ts`; export from `index.ts`.
- `src/cost/pricing.ts` — DeepSeek **direct-API** pricing entries (verify model IDs + prices; we currently price `openrouter:deepseek/deepseek-v4-{pro,flash}` only).
- `CLAUDE.md` — update the `## @broberg/ai-sdk` tier table (smart/powerful/fast/vision → Mistral; note Claude = non-default OpenRouter fallback).
- Tests: `tier-map.test.ts` (no default tier resolves to `anthropic`; new targets), `deepseek.test.ts` (mocked fetch), and a guard that a default `ai.chat({tier:"smart"})` needs no `ANTHROPIC_API_KEY`.

### Out of scope
- **Removing `anthropicAdapter`** — kept for non-default override use; Claude Code untouched.
- **Auto PII-detection / blind Mistral→DeepSeek fallback** — GDPR-unsafe; DeepSeek stays explicit-secondary.
- **Migrating `embedding` (openai) / `video` (gemini)** off US — they aren't Anthropic; raised as an Open Question, not done here.

## Architecture

### `deepseekAdapter` (`src/providers/deepseek.ts`)
```ts
export function deepseekAdapter(config: { apiKey?: string; baseUrl?: string } = {}): ProviderAdapter {
  return makeOpenAICompatibleAdapter({
    name: "deepseek",                                  // → key DEEPSEEK_API_KEY
    baseUrl: config.baseUrl ?? "https://api.deepseek.com/v1",
    apiKey: config.apiKey,
    costFromResponseField: false,                      // direct API: price from table
  });
}
```
DeepSeek's direct API is OpenAI-compatible (same pattern as `requesty`/`openrouter`). Model IDs on the direct API are aliases (`deepseek-chat`, `deepseek-reasoner`) — the exact "V4 Pro" slug + price need confirming (Open Q).

## Stories
- **F030.1** — Re-point `DEFAULT_TIER_MAP` to Mistral + `tier-map.test` (no-anthropic-default guard) + CLAUDE.md tier table.
- **F030.2** — `deepseekAdapter` + DeepSeek direct pricing + `deepseek.test` + registry/export.
- **F030.3** — Verify-no-anthropic-default end-to-end, release the version, report tiers/adapters changed to components + Christian.

## Acceptance criteria
1. **No default tier resolves to `anthropic`:** `resolveTier('fast'|'smart'|'powerful'|'vision')` each returns `provider==='mistral'` — asserted in `tier-map.test.ts`.
2. Targets: `smart`/`powerful` → `mistral-large-latest`, `fast`/`vision`/`cheap` → `mistral-small-latest` (vision support verified live or noted).
3. A default `ai.chat({ tier:'smart' })` with **no** `ANTHROPIC_API_KEY` set does NOT throw a missing-Anthropic-key error (it routes to Mistral) — test.
4. `deepseekAdapter` POSTs to `https://api.deepseek.com/v1/chat/completions` with `Bearer DEEPSEEK_API_KEY`, model passthrough, ship-dark throw without the key — mocked-fetch test; a DeepSeek pricing entry makes `costUsd` non-zero.
5. `CLAUDE.md` tier table matches the new `DEFAULT_TIER_MAP` (no drift).
6. Full `bun test` + typecheck green; version released; components + Christian told exactly which tiers/adapters changed.

## Dependencies
- [[anthropic-api-key-removed]] memory (the policy). `makeOpenAICompatibleAdapter` (exists). `mistralAdapter` (exists). A real `DEEPSEEK_API_KEY` only for a live smoke (not for build/tests).
- components `@broberg/secret-scan@0.1.6` already detects DeepSeek keys (`sk-`+32hex + `DEEPSEEK_API_KEY` anchor) — confirm the real key format to them if it differs.

## Rollout
**Behavior-changing for every consumer** (default model swaps Anthropic→Mistral), so: ship as a clear minor version + announce. Mistral defaults are GDPR-safe so this is also a net compliance improvement. Rollback = revert the tier-map commit. The `anthropic` provider stays available via override, so no consumer loses Claude access — only the *default* moves.

## Open Questions
1. **`powerful` target:** `mistral-large-latest` (frontier general) vs `magistral` (reasoning-with-audit) vs the DeepSeek V4 Pro secondary? Directive says Mistral primary → `mistral-large-latest`; confirm.
2. **DeepSeek V4 Pro exact direct-API model ID + price** (`deepseek-chat`/`deepseek-reasoner`/versioned slug) — verify before pricing.
3. **DeepSeek key format** — confirm to components (likely `sk-`-prefixed; exact length TBD once a real key exists).
4. **`embedding` (openai) / `video` (gemini):** migrate to EU (mistral-embed / an EU video route) in this F-number, or a separate one? They're not Anthropic.
5. **Secondary wiring:** DeepSeek as a built-in non-PII fallback array on the Mistral default, or purely opt-in via `override`? (PII must never auto-fall-back to CN.)

## Effort estimate
**M** — ~half-to-one day: tier re-point + tests is small; the DeepSeek adapter is ~15 lines; the care is in the GDPR/secondary wiring + verifying DeepSeek's model IDs/prices live.
