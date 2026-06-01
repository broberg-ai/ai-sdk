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

/** Keyed `${provider}:${model}`. */
const PRICING: Record<string, PricingEntry> = {
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

  // OpenRouter (meta-router — model slugs include the upstream vendor).
  "openrouter:anthropic/claude-sonnet-4-6": { inputPer1M: 3.0, outputPer1M: 15.0, version: V },
  "openrouter:anthropic/claude-haiku-4-5": { inputPer1M: 0.8, outputPer1M: 4.0, version: V },
  "openrouter:google/gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5, version: V },
  "openrouter:minimax/minimax-m2.7": {
    inputPer1M: 0.3,
    outputPer1M: 1.2,
    version: `${V}-estimate`,
  },

  // Google Gemini (direct). Image-gen model used by cms.
  "google:gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5, version: V },
};

export function getPrice(provider: string, model: string): PricingEntry | undefined {
  return PRICING[`${provider}:${model}`];
}
