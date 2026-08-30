// Tier routing: a named Tier resolves to a concrete (provider, model, transport).
// Precedence is per-call override > client config map > built-in defaults.
import type { Tier, TierSpec } from "../types.js";

/** Built-in defaults. Every entry is overridable via AiConfig.defaults or a
 *  per-call override.
 *
 *  F030 — Anthropic API phase-out: `ANTHROPIC_API_KEY` was globally removed, so the
 *  default cloud route may NOT hit Anthropic Console. `fast`/`smart`/`powerful`/
 *  `vision` now default to **Mistral EU** (Paris-hosted, Schrems II-safe — so every
 *  default text/vision call is GDPR-safe by default). Claude stays reachable as a
 *  NON-default quality fallback for non-PII via `override:{provider:"openrouter",
 *  model:"anthropic/claude-…"}`. DeepSeek (CN) is the opt-in non-PII secondary
 *  (`provider:"deepseek"`), never a default. Magistral (reasoning) / mistral-large
 *  for vision are per-call overrides, not defaults (don't pay the premium on all). */
export const DEFAULT_TIER_MAP: Record<Tier, TierSpec> = {
  fast: { provider: "mistral", model: "mistral-small-latest", transport: "http" },
  smart: { provider: "mistral", model: "mistral-large-latest", transport: "http" },
  powerful: { provider: "mistral", model: "mistral-large-latest", transport: "http" },
  cheap: { provider: "mistral", model: "mistral-small-latest", transport: "http" },
  // Vision: small-latest (vision-capable, cheap EU) is the default; override to
  // mistral-large-latest for demanding image/spatial/composition work.
  // F041 — bumped from mistral-small on Christian's ask, and the choice is MEASURED,
  // not assumed from price. On a fine-discrimination test (an 8x10 grid where one cell
  // differs only in its blue channel, 190->150) across 9 cases:
  //   mistral-medium-latest  4/9      <- best
  //   mistral-small-latest   1/6 + 0/3 = 1/9
  //   mistral-large-latest   0/9      <- WORSE than small, despite costing 5x more
  // Large ties small on easy colour blocks (4/4 each) and collapses on subtle ones,
  // so "bigger is better at vision" does not hold in Mistral's lineup. Nobody is good
  // at this task; medium is simply the only one that sees anything.
  vision: { provider: "mistral", model: "mistral-medium-latest", transport: "http" },
  // Native video understanding — Gemini leads; flash-lite is the cheap default (F019).
  // NOT Anthropic → out of the F030 phase-out (its own EU epic if/when needed).
  video: { provider: "gemini", model: "gemini-2.5-flash-lite", transport: "http" },
  // NOT Anthropic → out of F030 (EU-embedding migration is its own future epic).
  embedding: { provider: "openai", model: "text-embedding-3-small", transport: "http" },
};

/**
 * Resolve a Tier to a concrete TierSpec.
 *
 * Merge order (later wins): DEFAULT_TIER_MAP < configMap < override.
 * - `configMap` is the client-level AiConfig.defaults (per-tier full specs).
 * - `override` is a per-call Partial<TierSpec> — only the fields it sets win.
 */
export function resolveTier(
  tier: Tier,
  override?: Partial<TierSpec>,
  configMap?: Partial<Record<Tier, TierSpec>>,
  knownProviders?: readonly string[],
): TierSpec {
  const base = configMap?.[tier] ?? DEFAULT_TIER_MAP[tier];
  // F043: a provider-only override used to keep the TIER's model, so
  // `override:{provider:"anthropic"}` on tier "cheap" sent mistral-small-latest to
  // Anthropic's endpoint. Measured by coverletter 4/4 with distinct request_ids, and
  // it is the natural thing to write — it was literally the advice given to a repo
  // working around a missing Mistral key, so the escape hatch produced an error that
  // looked like "Anthropic is down".
  //
  // We REFUSE rather than re-resolve. Picking a model for the new provider would mean
  // the SDK making a price choice on the caller's behalf, and the bill would be the
  // only place that choice was visible. An explicit error costs one line to fix and
  // cannot be misread.
  // A provider the client has never heard of is a TYPO, and "no adapter registered
  // for \"nope\"" is the useful thing to say about it. Telling that caller to also set
  // a model would send them down a road that cannot work, so the mismatch guard steps
  // aside and lets the registry answer.
  const providerIsReal = knownProviders === undefined || knownProviders.includes(override?.provider ?? "");
  if (providerIsReal && override?.provider && override.model === undefined && override.provider !== base.provider) {
    throw new Error(
      `createAI: override sets provider "${override.provider}", but tier "${tier}" resolves to model ` +
        `"${base.model}", which belongs to "${base.provider}". Set a model too, e.g. ` +
        `override: { provider: "${override.provider}", model: "<a ${override.provider} model>" }.`,
    );
  }
  return { ...base, ...override };
}
