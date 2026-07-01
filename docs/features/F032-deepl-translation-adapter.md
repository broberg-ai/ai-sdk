# F032 — DeepL translation adapter (EU dedicated MT engine)

> Tier: provider/capability. Effort: S. Status: building. Origin: 2026-06-20 EU-model-landscape review (edenai.co survey) flagged DeepL as the clearest gap — a dedicated translation engine, EU-hosted (Sweden), vs today's LLM-prompt-based `ai.translate`.

## Motivation

`ai.translate` today is a **prompt contract on top of chat** (`buildTranslateMessages` → any chat-capable provider) — it has never had a dedicated translation engine behind it. DeepL is a purpose-built machine-translation model that generally outperforms general LLM chat models on straight text-to-text translation quality, is **EU-hosted** (Falun, Sweden per DeepL's own site), and has a genuinely free tier (500k chars/month per public docs) — a strictly-better option for high-volume or quality-sensitive translation than paying an LLM per token to do the same job. There is currently no dedicated `ProviderAdapter.translate` hook — `ai.translate` always forces every provider through `.chat`, which is wrong for a non-chat-shaped API like DeepL's.

## Solution

Add an optional **`ProviderAdapter.translate?(req)`** hook (mirroring how `tts`/`ocr`/`animate` are already optional, capability-specific adapter methods alongside the universal `chat`). Wire `ai.translate` in `client.ts` to prefer `adapter.translate` when the resolved provider implements it, falling back to the existing chat-prompt-contract otherwise — **zero behavior change** for every existing provider (anthropic/mistral/openai/etc. don't implement `.translate`, so they keep going through chat exactly as today). Add `deeplAdapter` as the first (and initially only) provider implementing the new hook, opt-in via `override:{provider:"deepl"}`.

## Scope

### In scope
- **`TranslateRequest { text, to, from?, spec }`** added to `src/types.ts`; `ProviderAdapter.translate?(req: TranslateRequest): Promise<TranslateResult>`.
- **`client.ts`'s `translate()`** — check `pickProvider(spec.provider).translate` first; if present, call it directly (`{text: input.text, to: input.to, from: input.from, spec}`), skip `buildTranslateMessages`/chat entirely. Else fall back to today's chat-based path unchanged.
- **`src/providers/deepl.ts`** — `deeplAdapter(config?: {apiKey?, baseUrl?, fetch?, pricePer1kChars?})`:
  - Auth: `DEEPL_API_KEY` env or `config.apiKey`. Header `Authorization: DeepL-Auth-Key <key>` (DeepL's own scheme, NOT `Bearer`).
  - **Free vs Pro auto-detect**: a DeepL Free API key always ends in `:fx` (documented DeepL convention) → base URL `https://api-free.deepl.com`; otherwise `https://api.deepl.com` (Pro). Overridable via `config.baseUrl` for testing/self-hosted-proxy cases.
  - `translate(req)`: `POST {baseUrl}/v2/translate` JSON body `{ text: [req.text], target_lang: req.to.toUpperCase(), ...(req.from ? { source_lang: req.from.toUpperCase() } : {}) }`. Response `{ translations: [{ text, detected_source_language }] }` → `translations[0].text`.
  - **Cost**: per-character estimate — see Pricing note below. `usage.capability = "translate"`.
  - Ship-dark: no key → throws only when `translate()` is called (never at construction).
- Register `deepl: deeplAdapter()` in `src/providers/registry.ts`; export `deeplAdapter` from `src/index.ts`.
- `src/providers/deepl.test.ts` — mocked-fetch: Free-key (`:fx` suffix) routes to `api-free.deepl.com`, Pro-key routes to `api.deepl.com`; request body/headers exact; response parsing; cost calc; ship-dark; `ai.translate({override:{provider:"deepl"}})` end-to-end; confirms the existing chat-based path (e.g. `mistral`/`anthropic`) is UNCHANGED (regression guard on the fallback branch).
- `docs/API.md` — `ai.translate` row/section: note the DeepL opt-in route + the language-code contract difference (below).

### Out of scope
- **Changing `TRANSLATE_DEFAULT_TIER`** — stays `"fast"` (LLM-based, unchanged default). DeepL is opt-in only, same pattern as every other EU specialist added this cycle (Azure TTS, Vertex Veo, BFL portraits) — never flip a default without a deliberate, separate decision.
- **Natural-language → DeepL-code mapping.** DeepL requires real target-language codes (`"DA"`, `"EN-US"`, `"DE"`, …), NOT free-form names like the chat-based route accepts today (`to:"Danish"` works when routed to an LLM; it would NOT work against DeepL — `"DANISH"` is not a valid `target_lang`). Building a name→code table would mean inventing translations of a lookup table without a verified complete source — a real fabrication risk. **The contract is: when you opt into `override:{provider:"deepl"}`, `to`/`from` must be valid DeepL language codes.** Documented, not silently patched over.
- **Glossaries, document translation, formality parameter, batch translation** — DeepL API features beyond plain text `to`/`from` translate; not needed for the current `TranslateInput` shape. Candidate future F-numbers if a real need appears.
- **Auto-selecting DeepL as fallback for EU/GDPR translate calls** — not wired into any GDPR-override logic; purely additive/opt-in for now.

## Architecture

### `deeplAdapter` (`src/providers/deepl.ts`)
```ts
export function deeplAdapter(config?: {
  apiKey?: string; baseUrl?: string; fetch?: typeof fetch; pricePer1kChars?: number;
}): ProviderAdapter;
// translate(req): POST {baseUrl}/v2/translate, Authorization: DeepL-Auth-Key <key>
//   body { text:[req.text], target_lang: req.to.toUpperCase(), source_lang?: req.from?.toUpperCase() }
//   → { text: translations[0].text, usage }
```
Base-URL auto-detection: `key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com"`.

### `ProviderAdapter.translate?` (`src/types.ts`)
```ts
export interface TranslateRequest { text: string; to: string; from?: string; spec: TierSpec; }
// on ProviderAdapter: translate?(req: TranslateRequest): Promise<TranslateResult>;
```

### `client.ts` routing change (surgical)
```ts
invoke: async (spec) => {
  const adapter = pickProvider(spec.provider);
  if (adapter.translate) return adapter.translate({ text: input.text, to: input.to, from: input.from, spec });
  if (!adapter.chat) throw new Error(`createAI: provider "${spec.provider}" does not support chat (translate routes through chat)`);
  return adapter.chat({ messages: buildTranslateMessages(input), spec });
},
```

### Pricing (honest, not fabricated)
DeepL's own pricing pages (deepl.com/pro-api, support.deepl.com) are JS-rendered / bot-protected — live fetch during this planning session returned no extractable numbers (WebFetch: "cannot extract pricing", support.deepl.com: 403). Third-party aggregators (checked 2026-06-20) converge loosely around **~€20 per 1,000,000 characters** for the Pro API pay-as-you-go tier (≈ $0.0217/1k chars at a rough EUR/USD rate), but at least one source describes a newer subscription-tier model (`$26/mo` base including an allowance) that may supersede it — **genuinely uncertain, not verified against DeepL's own current page**. Ship a `DEEPL_PRICE_PER_1K_CHARS` constant clearly commented as an **unverified estimate**, fully overridable via `config.pricePer1kChars` (same override-hook pattern as `elevenlabsAdapter`/`azureAdapter`). Free-tier usage (a `:fx` key within its free quota) is genuinely $0 — the estimate only matters once/if a Pro key is used past the free allowance. **Before this cost number is relied on for a real budget decision, verify it against DeepL's current pricing page directly (manually, since it resists automated fetch).**

## Stories
- **F032.1** — `ProviderAdapter.translate?` hook + `client.ts` routing (adapter.translate-first, chat-fallback) — regression-tested against the existing chat-based path.
- **F032.2** — `deeplAdapter` (Free/Pro auto-detect, translate(), cost estimate, ship-dark) + registry/export + mocked-fetch tests.
- **F032.3** — `docs/API.md` note (DeepL opt-in route + language-code contract difference); live smoke once `DEEPL_API_KEY` is set (DeepL's free tier means this can be tested at zero cost); release + ping components/cardmem.

## Acceptance criteria
1. `ai.translate({ text, to:"DA", override:{provider:"deepl"} })` calls `deeplAdapter.translate` directly (not `buildTranslateMessages`/chat) — verified by a mocked-fetch test.
2. A Free-tier key (ending `:fx`) routes to `api-free.deepl.com`; a Pro key routes to `api.deepl.com` — both asserted.
3. Request body matches DeepL's documented shape (`text:[...]`, `target_lang` uppercased, optional `source_lang`); header is `Authorization: DeepL-Auth-Key <key>` (not `Bearer`) — asserted.
4. `usage.provider==="deepl"`, `usage.capability==="translate"`, `costUsd` computed from the configurable per-1k-char rate — asserted; overriding `config.pricePer1kChars` changes the result.
5. Ship-dark: no `DEEPL_API_KEY` → clear throw only when `translate()` is called.
6. **Regression**: existing chat-based translate (e.g. default `fast` tier, or any provider without `.translate`) is provably unchanged — a test asserts `buildTranslateMessages`/`.chat` still fires when no `.translate` hook exists.
7. Full `bun test` suite green; typecheck clean.
8. F032.3: one real translation via DeepL's free tier (zero cost) once `DEEPL_API_KEY` is set; `docs/API.md` updated; version bumped + published; components/cardmem pinged.

## Dependencies
- Existing `ai.translate` capability. No blocking SDK dependency.
- Christian provisions a DeepL API key (free-tier signup is self-service, no payment needed to get a working `:fx` key) — the only human-gated step for F032.3's live smoke.

## Rollout
Additive, ship-dark, single-phase. New optional `ProviderAdapter.translate` hook is backward-compatible (every existing adapter simply doesn't implement it, unchanged behavior). `TRANSLATE_DEFAULT_TIER` untouched — DeepL is purely opt-in. Rollback = drop the registry entry + the `adapter.translate` branch in `client.ts` (reverts to always-chat).

## Open Questions
None blocking. (DeepL pricing is an acknowledged estimate, not a blocking unknown — the free tier makes F032.3's live smoke zero-cost regardless.)

## Effort estimate
**S** — ~half a day; DeepL's API is small (one endpoint) and the free tier means the live smoke (F032.3) needs no payment step, only a self-service signup.
