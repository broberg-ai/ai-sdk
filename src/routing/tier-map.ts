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
/** Refuse an override that names a different provider without naming a model (F043.2).
 *
 *  Exported and called at EVERY spec merge, not only inside resolveTier. The first
 *  version guarded only the six capabilities that route via a tier; image, animate,
 *  trainStyle, ocr, moderate, podcast, tts, transcribe and batch merge the override
 *  themselves and skipped it entirely — so `ai.image({override:{provider:"fal"}})`
 *  still posted BFL's flux-2-pro to fal, the exact misleading upstream error this was
 *  written to kill. A guard at six of fifteen call sites is a guard you cannot rely on.
 *
 *  We REFUSE rather than re-resolve: choosing a model for the new provider would be
 *  the SDK making a price decision on the caller's behalf, visible only on the bill.
 *
 *  `knownProviders` (when given) lets an UNREGISTERED provider through — that is a
 *  typo, and "no provider adapter registered" is the useful thing to say about it. */
export function assertOverrideProvider(
  base: { provider: string; model: string },
  override: Partial<TierSpec> | undefined,
  label: string,
  knownProviders?: readonly string[],
): void {
  if (!override?.provider || override.model !== undefined) return;
  if (override.provider === base.provider) return;
  if (knownProviders !== undefined && !knownProviders.includes(override.provider)) return;
  throw new Error(
    `createAI: override sets provider "${override.provider}", but "${label}" resolves to model ` +
      `"${base.model}", which belongs to "${base.provider}". Set a model too, e.g. ` +
      `override: { provider: "${override.provider}", model: "<a ${override.provider} model>" }.`,
  );
}

export function resolveTier(
  tier: Tier,
  override?: Partial<TierSpec>,
  configMap?: Partial<Record<Tier, TierSpec>>,
  knownProviders?: readonly string[],
): TierSpec {
  const base = configMap?.[tier] ?? DEFAULT_TIER_MAP[tier];
  assertOverrideProvider(base, override, tier, knownProviders);
  return { ...base, ...override };
}
