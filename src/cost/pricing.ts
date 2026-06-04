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
  "anthropic:claude-haiku-4-5": {
    inputPer1M: 0.8,
    outputPer1M: 4.0,
    cacheReadPer1M: 0.08,
    cacheWritePer1M: 1.0,
    version: V,
  },
  "anthropic:claude-sonnet-4-6": {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
    version: V,
  },
  "anthropic:claude-opus-4-8": {
    inputPer1M: 15.0,
    outputPer1M: 75.0,
    cacheReadPer1M: 1.5,
    cacheWritePer1M: 18.75,
    version: V,
  },

  // OpenAI. embedding default tier = text-embedding-3-small (no output tokens).
  "openai:text-embedding-3-small": { inputPer1M: 0.02, outputPer1M: 0, version: V },
  "openai:text-embedding-3-large": { inputPer1M: 0.13, outputPer1M: 0, version: V },
  "openai:gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0, version: V },
  "openai:gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6, version: V },
  // Whisper is priced per minute, not per token — not representable here; transcribe
  // (F5.6) computes its own cost. Listed as 0 so token-based compute never charges it.
  "openai:whisper-1": { inputPer1M: 0, outputPer1M: 0, version: V },

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

  // Google Gemini (direct). Provider key is "gemini" — matches the adapter's
  // usage.provider + the override.provider callers pass. (Image-gen models are
  // priced per-image in the adapter, not here.)
  "gemini:gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5, version: V },
  // flash-lite is the default `video` tier (F019) — cheap native video understanding.
  "gemini:gemini-2.5-flash-lite": { inputPer1M: 0.1, outputPer1M: 0.4, version: "2026-06-04-or-xref" },

  // Mistral (direct, La Plateforme). Official prices from mistral.ai/pricing
  // (2026-06-04, per Christian's CD report). EU/Paris-hosted — the designated
  // GDPR-safe provider for client/personal-data workloads (see F015). NB:
  // medium-3.5 is the premium "Vibe" coding tier ($1.5/$7.5); Large 3 ($0.5/$1.5)
  // is the cheaper frontier general-purpose model despite the higher number.
  "mistral:mistral-large-latest": { inputPer1M: 0.5, outputPer1M: 1.5, version: MS },
  "mistral:mistral-large-2512": { inputPer1M: 0.5, outputPer1M: 1.5, version: MS },
  "mistral:mistral-medium-latest": { inputPer1M: 1.5, outputPer1M: 7.5, version: MS },
  "mistral:mistral-medium-3.5": { inputPer1M: 1.5, outputPer1M: 7.5, version: MS },
  "mistral:mistral-medium-3": { inputPer1M: 0.4, outputPer1M: 2.0, version: "2026-06-04-or-xref" },
  "mistral:mistral-small-latest": { inputPer1M: 0.1, outputPer1M: 0.3, version: MS },
  "mistral:mistral-small-2603": { inputPer1M: 0.1, outputPer1M: 0.3, version: MS },
  "mistral:ministral-3b-latest": { inputPer1M: 0.1, outputPer1M: 0.1, version: MS },
  "mistral:ministral-8b-latest": { inputPer1M: 0.15, outputPer1M: 0.15, version: MS },
  "mistral:ministral-14b-latest": { inputPer1M: 0.2, outputPer1M: 0.2, version: MS },
  "mistral:magistral-medium-latest": { inputPer1M: 2.0, outputPer1M: 5.0, version: MS },
  "mistral:magistral-small-latest": { inputPer1M: 0.5, outputPer1M: 1.5, version: MS },
  "mistral:devstral-latest": { inputPer1M: 0.4, outputPer1M: 2.0, version: MS },
  "mistral:codestral-latest": { inputPer1M: 0.3, outputPer1M: 0.9, version: MS },
  "mistral:open-mistral-nemo": { inputPer1M: 0.15, outputPer1M: 0.15, version: MS },
  // Moderation (F016.4) — per input token; output 0. (OCR is per-page in the adapter.)
  "mistral:mistral-moderation-latest": { inputPer1M: 0.1, outputPer1M: 0, version: MS },
};

export function getPrice(provider: string, model: string): PricingEntry | undefined {
  const exact = PRICING[`${provider}:${model}`];
  if (exact) return exact;
  // Providers ship dated model snapshots, e.g. "claude-haiku-4-5-20251001".
  // Strip a trailing -YYYYMMDD and retry the base lookup so a dated variant
  // prices the same as its base model instead of falling through to 0 — a real
  // paid call must never be logged as $0 (F012). Covers openrouter slugs too.
  const base = model.replace(/-\d{8}$/, "");
  if (base !== model) return PRICING[`${provider}:${base}`];
  return undefined;
}
