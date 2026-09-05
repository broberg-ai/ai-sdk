// Versioned per-(provider, model) pricing. F3.6 populates the table + adds tests
// + MiniMax coverage. F3.1 ships the type + lookup with an empty table, so
// computeCost returns 0 for every model until F3.6 lands (calls still complete).
export interface PricingEntry {
  /** USD per 1M input tokens. */
  inputPer1M: number;
  /** USD per 1M output tokens. */
  outputPer1M: number;
  /** USD per 1M cache-read tokens (falls back to input rate if unset). */
  cacheReadPer1M?: number;
  /** USD per 1M cache-write/creation tokens (falls back to input rate if unset). */
  cacheWritePer1M?: number;
  /** Pricing snapshot version (date or tag) so stale entries are detectable. */
  version: string;
}

// USD per 1M tokens. Anthropic cache multipliers follow the standard model:
// cache-read ≈ 0.1× input, cache-write ≈ 1.25× input. Verified against the
// pricing tables in cms (packages/cms-ai/src/providers) + trail (model-lab).
// MiniMax M2.7 is an estimate pending confirmation against OpenRouter's live
// price page — flagged in its version string.
const V = "2026-06-02";
// Mistral prices come straight from mistral.ai/pricing (per Christian's CD report).
const MS = "2026-06-04-mistral.ai";

/** Keyed `${provider}:${model}`. Exported so the catalogue-research job (F014)
 *  can enumerate every priced entry and diff it against the live provider lists. */
export const PRICING: Record<string, PricingEntry> = {
  // Anthropic (direct API). DEFAULT_TIER_MAP: fast/cheap=haiku, smart/vision=sonnet, powerful=opus.
  // $1.00/$5.00 — Anthropic's published Haiku 4.5 rate, confirmed against the
  // claude-api skill's model table 2026-09-03. F048: this row said $0.80/$4.00 while
  // "openrouter:anthropic/claude-haiku-4.5" said $1.00/$5.00 — the SAME model at two
  // prices, and the shorter, likelier id carried the wrong one. A consumer pricing
  // 68M haiku tokens (upmetrics' real volume) was told 20% under.
  "anthropic:claude-haiku-4-5": {
    inputPer1M: 1.0,
    outputPer1M: 5.0,
    cacheReadPer1M: 0.1,
    cacheWritePer1M: 1.25,
    version: "2026-09-03",
  },
  "anthropic:claude-sonnet-4-6": {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
    version: V,
  },
  // $5.00/$25.00 — Anthropic's published Opus 4.8 rate, confirmed against the
  // claude-api skill's model table 2026-09-03.
  //
  // FOUND BY THE CONTRADICTION GUARD ON ITS FIRST RUN, not by a report. This row said
  // $15.00/$75.00 while "openrouter:anthropic/claude-opus-4.8" said $5.00/$25.00 —
  // THREE TIMES too high, the opposite direction from the haiku error and a larger
  // multiple. Nobody had noticed, because both numbers looked like answers.
  "anthropic:claude-opus-4-8": {
    inputPer1M: 5.0,
    outputPer1M: 25.0,
    cacheReadPer1M: 0.5,
    cacheWritePer1M: 6.25,
    version: "2026-09-03",
  },

  // OpenAI. embedding default tier = text-embedding-3-small (no output tokens).
  // Cached input is 50% of the input rate — $1.25 vs $2.50 (gpt-4o) and $0.075 vs
  // $0.15 (gpt-4o-mini), read from developers.openai.com/api/docs/pricing on
  // 2026-08-27. NOTE IT IS 50%, NOT the 10% Mistral and Gemini charge: assuming one
  // uniform discount across providers would have understated OpenAI's cost by 4x on
  // the cached half. Caching is automatic above 1,024 tokens — no key, no opt-in.
  // The embedding models list NO cached price (embeddings do not cache), so they
  // deliberately get no row here rather than a guessed one.
  "openai:text-embedding-3-small": { inputPer1M: 0.02, outputPer1M: 0, version: V },
  "openai:text-embedding-3-large": { inputPer1M: 0.13, outputPer1M: 0, version: V },
  "openai:gpt-4o": { inputPer1M: 2.5, cacheReadPer1M: 1.25, outputPer1M: 10.0, version: "2026-08-27-developers.openai.com" },
  "openai:gpt-4o-mini": { inputPer1M: 0.15, cacheReadPer1M: 0.075, outputPer1M: 0.6, version: "2026-08-27-developers.openai.com" },
  // Whisper is priced per MINUTE — see MEDIA_PRICING in ./media-pricing.ts. It used to
  // sit here as 0/0 "so token-based compute never charges it", and inwardly that worked.
  // Outwardly it did not: getModelPrice("whisper-1") answered `{unit:"per_1m_tokens",
  // inputPer1M: 0}` — i.e. "this model is free" — because media rows are consulted LAST
  // and a token row was already there. The per-minute price was unreachable by its own
  // id. computeCost still returns 0 for it (no entry) and transcribe still computes its
  // own cost, so nothing about billing changed; only the public answer stopped lying.

  // OpenRouter (meta-router — model slugs include the upstream vendor). Slugs use
  // dots (claude-sonnet-4.6) to match OpenRouter's live ids; the dashed forms
  // never matched a real call. Caught by the F014 catalogue research.
  "openrouter:anthropic/claude-sonnet-4.6": { inputPer1M: 3.0, outputPer1M: 15.0, version: V },
  // OpenRouter ground-truth $1/$5 — a markup over Anthropic-direct's $0.8/$4
  // (the `anthropic:` entry above). Was masked while the slug used dashes.
  "openrouter:anthropic/claude-haiku-4.5": { inputPer1M: 1.0, outputPer1M: 5.0, version: "2026-06-04" },
  "openrouter:google/gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5, version: V },
  // Ground-truth from OpenRouter /api/v1/models (was a 0.3 estimate; now 0.279).
  "openrouter:minimax/minimax-m2.7": {
    inputPer1M: 0.279,
    outputPer1M: 1.2,
    version: "2026-06-04",
  },
  // DeepSeek V4 (CN-hosted — NOT GDPR-safe; non-personal-data workloads only).
  // On 2026-05-22 DeepSeek made the "75% off" promo the permanent official price.
  // V4-Pro $0.435/$0.87 is ~34x cheaper than GPT-5.5 on output; flash is cheaper
  // still. Numbers match OpenRouter /api/v1/models 1:1 (no router markup). A strong
  // cheap route for fleet background work once `claude -p` is API-billed (15 Jun).
  "openrouter:deepseek/deepseek-v4-pro": { inputPer1M: 0.435, outputPer1M: 0.87, version: "2026-05-22-deepseek-official" },
  "openrouter:deepseek/deepseek-v4-flash": { inputPer1M: 0.0983, outputPer1M: 0.1966, version: "2026-05-22-deepseek-official" },
  // DeepSeek DIRECT API (provider "deepseek", F030 non-PII secondary). Rates from
  // api-docs.deepseek.com 2026-06-30 ($0.14/$0.28 per 1M; both map to deepseek-v4-flash).
  // `deepseek-chat` (non-thinking) + `deepseek-reasoner` (thinking) DEPRECATE 2026-07-24.
  // (The bare `deepseek-v4-flash` basename is already priced via the openrouter entry
  // above — kept distinct here to avoid a basename collision in the F027 pricing-API.)
  // Verify against a real key when it lands.
  "deepseek:deepseek-chat": { inputPer1M: 0.14, outputPer1M: 0.28, version: "2026-06-30-deepseek-direct" },
  "deepseek:deepseek-reasoner": { inputPer1M: 0.14, outputPer1M: 0.28, version: "2026-06-30-deepseek-direct" },

  // Cached input tokens cost 10% of the input rate — $0.03 vs $0.30 (2.5-flash) and
  // $0.01 vs $0.10 (2.5-flash-lite), read from ai.google.dev/gemini-api/docs/pricing
  // on 2026-08-27 rather than recalled. NB the storage fee on that page ($1/1M
  // tokens/hour) applies to EXPLICIT context caching, where you create a CachedContent
  // object with a TTL. We use IMPLICIT caching, which has no storage charge — so this
  // table is not silently under-billing.
  // Google Gemini (direct). Provider key is "gemini" — matches the adapter's
  // usage.provider + the override.provider callers pass. (Image-gen models are
  // priced per-image in the adapter, not here.)
  "gemini:gemini-2.5-flash": { inputPer1M: 0.3, cacheReadPer1M: 0.03, outputPer1M: 2.5, version: "2026-08-27-ai.google.dev" },
  // flash-lite is the default `video` tier (F019) — cheap native video understanding.
  "gemini:gemini-2.5-flash-lite": { inputPer1M: 0.1, cacheReadPer1M: 0.01, outputPer1M: 0.4, version: "2026-08-27-ai.google.dev" },

  // Vertex AI (F038) — the EU-resident route to the SAME Gemini models, so Google's
  // published Gemini token prices apply. Listed separately because cost lookups key on
  // `provider:model`: without these rows an EU vision/video call would silently log
  // $0, which is worse than no tracking (a confident wrong number).
  "vertex:gemini-2.5-flash": { inputPer1M: 0.3, cacheReadPer1M: 0.03, outputPer1M: 2.5, version: "2026-08-27-ai.google.dev" },
  "vertex:gemini-2.5-flash-lite": { inputPer1M: 0.1, cacheReadPer1M: 0.01, outputPer1M: 0.4, version: "2026-08-27-ai.google.dev" },

  // Cached prompt tokens bill at 10% of the input rate (F039, measured 2026-08-27:
  // an 8,810-token prefix reported 8,784 cached on the second call WITH a
  // prompt_cache_key, and 0 without one at every size up to 57k).
  // Mistral (direct, La Plateforme). Official prices from mistral.ai/pricing
  // (2026-06-04, per Christian's CD report). EU/Paris-hosted — the designated
  // GDPR-safe provider for client/personal-data workloads (see F015). NB:
  // medium-3.5 is the premium "Vibe" coding tier ($1.5/$7.5); Large 3 ($0.5/$1.5)
  // is the cheaper frontier general-purpose model despite the higher number.
  "mistral:mistral-large-latest": { inputPer1M: 0.5, cacheReadPer1M: 0.05, outputPer1M: 1.5, version: MS },
  "mistral:mistral-large-2512": { inputPer1M: 0.5, cacheReadPer1M: 0.05, outputPer1M: 1.5, version: MS },
  "mistral:mistral-medium-latest": { inputPer1M: 1.5, cacheReadPer1M: 0.15, outputPer1M: 7.5, version: MS },
  "mistral:mistral-medium-3.5": { inputPer1M: 1.5, cacheReadPer1M: 0.15, outputPer1M: 7.5, version: MS },
  "mistral:mistral-medium-3": { inputPer1M: 0.4, cacheReadPer1M: 0.04, outputPer1M: 2.0, version: "2026-06-04-or-xref" },
  "mistral:mistral-small-latest": { inputPer1M: 0.1, cacheReadPer1M: 0.01, outputPer1M: 0.3, version: MS },
  "mistral:mistral-small-2603": { inputPer1M: 0.1, cacheReadPer1M: 0.01, outputPer1M: 0.3, version: MS },
  "mistral:ministral-3b-latest": { inputPer1M: 0.1, cacheReadPer1M: 0.01, outputPer1M: 0.1, version: MS },
  "mistral:ministral-8b-latest": { inputPer1M: 0.15, cacheReadPer1M: 0.015, outputPer1M: 0.15, version: MS },
  "mistral:ministral-14b-latest": { inputPer1M: 0.2, cacheReadPer1M: 0.02, outputPer1M: 0.2, version: MS },
  "mistral:magistral-medium-latest": { inputPer1M: 2.0, cacheReadPer1M: 0.2, outputPer1M: 5.0, version: MS },
  "mistral:magistral-small-latest": { inputPer1M: 0.5, cacheReadPer1M: 0.05, outputPer1M: 1.5, version: MS },
  "mistral:devstral-latest": { inputPer1M: 0.4, cacheReadPer1M: 0.04, outputPer1M: 2.0, version: MS },
  "mistral:codestral-latest": { inputPer1M: 0.3, cacheReadPer1M: 0.03, outputPer1M: 0.9, version: MS },
  "mistral:open-mistral-nemo": { inputPer1M: 0.15, cacheReadPer1M: 0.015, outputPer1M: 0.15, version: MS },
  // Moderation (F016.4) — per input token; output 0. (OCR is per-page in the adapter.)
  "mistral:mistral-moderation-latest": { inputPer1M: 0.1, cacheReadPer1M: 0.01, outputPer1M: 0, version: MS },
  // Embeddings (F016.5) — per input token.
  "mistral:mistral-embed": { inputPer1M: 0.1, cacheReadPer1M: 0.01, outputPer1M: 0, version: MS },
  "mistral:codestral-embed": { inputPer1M: 0.15, cacheReadPer1M: 0.015, outputPer1M: 0, version: MS },
  // F048 — reported by upmetrics as an unknown model (6 calls). Official mistral.ai/pricing.
  "mistral:pixtral-large-latest": { inputPer1M: 2.0, cacheReadPer1M: 0.2, outputPer1M: 6.0, version: "2026-09-03" },
};

/** Strip a provider's dated snapshot suffix: "claude-haiku-4-5-20251001" → "claude-haiku-4-5".
 *  Returns the input unchanged when there is no suffix.
 *
 *  ONE definition, used by BOTH lookups. F012 taught this rule to `getPrice` — the
 *  internal cost path — and the exported catalogue never learned it, so for two years
 *  `usage.costUsd` priced a dated id correctly while `getModelPrice` returned undefined
 *  for the same string. Found by upmetrics, who use the catalogue and not our internals:
 *  19,456 calls of `claude-haiku-4-5-20251001` looked like an unknown model. Fixing the
 *  instance and not the class is the shape; a copy of this regex in the other lookup
 *  would have been the same mistake a third time. */
export function stripDatedSuffix(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

export function getPrice(provider: string, model: string): PricingEntry | undefined {
  const exact = PRICING[`${provider}:${model}`];
  if (exact) return exact;
  // A real paid call must never be logged as $0 (F012).
  const base = stripDatedSuffix(model);
  if (base !== model) return PRICING[`${provider}:${base}`];
  return undefined;
}
