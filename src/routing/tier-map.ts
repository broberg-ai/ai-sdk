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
  vision: { provider: "mistral", model: "mistral-small-latest", transport: "http" },
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
): TierSpec {
  const base = configMap?.[tier] ?? DEFAULT_TIER_MAP[tier];
  return { ...base, ...override };
}
