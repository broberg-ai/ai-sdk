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

/** Keyed `${provider}:${model}`. Populated in F3.6. */
const PRICING: Record<string, PricingEntry> = {};

export function getPrice(provider: string, model: string): PricingEntry | undefined {
  return PRICING[`${provider}:${model}`];
}
