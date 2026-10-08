// F077.2 — "which concrete version is this tier right now, and what does it cost?"
// Asked by trail for its settings page and by the owner for the fleet: a tier name
// says nothing about the bill, and resolveModel answers the model but not the price.
import type { Tier } from "../types.js";
import { DEFAULT_TIER_MAP } from "./tier-map.js";
import { getPrice } from "../cost/pricing.js";

export interface TierDescription {
  tier: Tier;
  provider: string;
  model: string;
  /** false when the model is a "-latest" alias the provider can move under us. */
  pinned: boolean;
  /** USD per 1M tokens from the pricing table; undefined when the model is unpriced. */
  inputPer1M?: number;
  outputPer1M?: number;
  cacheReadPer1M?: number;
}

/** The built-in default for a tier. A client's own `defaults` or a per-call
 *  `override` can route elsewhere — read usage.model off the response for that. */
export function describeTier(tier: Tier): TierDescription {
  const spec = DEFAULT_TIER_MAP[tier];
  if (!spec) throw new Error(`describeTier: unknown tier "${tier}" — valid: ${Object.keys(DEFAULT_TIER_MAP).join(", ")}`);
  const price = getPrice(spec.provider, spec.model);
  return {
    tier,
    provider: spec.provider,
    model: spec.model,
    pinned: !spec.model.endsWith("-latest"),
    ...(price ? { inputPer1M: price.inputPer1M, outputPer1M: price.outputPer1M, ...(price.cacheReadPer1M !== undefined ? { cacheReadPer1M: price.cacheReadPer1M } : {}) } : {}),
  };
}
