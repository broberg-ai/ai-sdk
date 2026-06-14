// Tier routing: a named Tier resolves to a concrete (provider, model, transport).
// Precedence is per-call override > client config map > built-in defaults.
import type { Tier, TierSpec } from "../types.js";

/** Built-in defaults. Every entry is overridable via AiConfig.defaults or a
 *  per-call override. Model IDs are current at scaffold time; callers pin their
 *  own via config. `cheap` defaults to the cheapest-that's-good-enough cloud
 *  model — Mistral Small (EU/Paris-hosted, GDPR-safe, ~$0.10/$0.30) — so even a
 *  cost-tier call is safe for personal data by default; everything else is HTTP.
 *  (The `claude -p` subprocess transport still exists for explicit override, but
 *  is no longer a default route — the fleet's agent-CLI transport moved off it.) */
export const DEFAULT_TIER_MAP: Record<Tier, TierSpec> = {
  fast: { provider: "anthropic", model: "claude-haiku-4-5", transport: "http" },
  smart: { provider: "anthropic", model: "claude-sonnet-4-6", transport: "http" },
  powerful: { provider: "anthropic", model: "claude-opus-4-8", transport: "http" },
  cheap: { provider: "mistral", model: "mistral-small-latest", transport: "http" },
  vision: { provider: "anthropic", model: "claude-sonnet-4-6", transport: "http" },
  // Native video understanding — Gemini leads; flash-lite is the cheap default (F019).
  video: { provider: "gemini", model: "gemini-2.5-flash-lite", transport: "http" },
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
