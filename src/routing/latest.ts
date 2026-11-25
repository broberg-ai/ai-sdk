// F096 — «LATEST» routes. Owner 2026-11-26: «ruter hvor man altid kan bede efter
// LATEST … det er DIG der har researchet på hvad der er nyest … Det skal aldrig være
// den enkelte fleet agents ansvar».
//
// A consumer asks for a FAMILY (`override: { model: "claude-sonnet-latest" }`, no
// provider) and ai-sdk answers with the newest model it has researched and PINNED to a
// dated/versioned id. That is not a provider's floating `-latest` (D-385d97 holds): a
// move happens in an ai-sdk release, visible with a version, never silently upstream.
// usage.model on every response says which dated model actually answered.
//
// Kept current by the model-research skill (every 14 days): check each family for a
// newer dated model, move the row, bump `checkedAt`, release.
import type { TierSpec } from "../types.js";

export interface LatestEntry {
  /** The alias a consumer writes. */
  alias: string;
  provider: string;
  /** Dated / versioned model id — never a floating one. */
  model: string;
  /** When ai-sdk last confirmed this is the newest in the family (YYYY-MM-DD). */
  checkedAt: string;
}

const CHECKED = "2026-11-26";

export const LATEST: readonly LatestEntry[] = [
  // F097 — owner 2026-11-26: «både Deep og Anthropic kører igennem EU så vi skal bare bede
  // om at bruge OpenRouter eller EU modeller». Claude via OpenRouter's EU host, not
  // Anthropic direct (US): every family below answers from the EU.
  { alias: "claude-haiku-latest", provider: "openrouter", model: "anthropic/claude-haiku-5.5", checkedAt: CHECKED },
  { alias: "claude-sonnet-latest", provider: "openrouter", model: "anthropic/claude-sonnet-5.5", checkedAt: CHECKED },
  { alias: "claude-opus-latest", provider: "openrouter", model: "anthropic/claude-opus-5.5", checkedAt: CHECKED },
  { alias: "mistral-large-latest", provider: "mistral", model: "mistral-large-4-0", checkedAt: CHECKED },
  // F097 — the newest DeepSeek Flash OpenRouter serves IN THE EU (measured 2026-11-26);
  // v4.1-flash-1017 has no EU endpoint, and all OpenRouter calls now go via the EU host.
  { alias: "deepseek-flash-latest", provider: "openrouter", model: "deepseek/deepseek-v4-flash-0731", checkedAt: CHECKED },
];

const BY_ALIAS = new Map(LATEST.map((e) => [e.alias, e]));

/** Every LATEST family, for a model picker. */
export function listLatest(): LatestEntry[] {
  return LATEST.map((e) => ({ ...e }));
}

/** The pinned model behind an alias, or undefined if ai-sdk has no such family. */
export function resolveLatest(alias: string): LatestEntry | undefined {
  const e = BY_ALIAS.get(alias);
  return e ? { ...e } : undefined;
}

/** Expand `override: { model: "<family>-latest" }` (WITHOUT a provider) to the pinned
 *  provider + model. With a provider the override is left alone, so a provider-native
 *  id such as `{ provider: "mistral", model: "mistral-large-latest" }` behaves exactly as
 *  before. An unknown `*-latest` without a provider fails closed, like a misspelt tier. */
/** F097 — owner 2026-11-26: «gør det nemt for agenterne … at kalde alle modeller gennem
 *  OpenRouter EU pånær Mistral den kalder vi direkte». An OpenRouter model id written
 *  WITHOUT a provider (`override: { model: "moonshotai/kimi-k2.6" }`) routes to OpenRouter,
 *  whose default host is the EU one. Only these vendor prefixes, so another provider's
 *  slash ids (fal-ai/…, DeepInfra's org/model) are never captured; `mistralai/` is left
 *  out on purpose — Mistral is called direct (tiers / provider "mistral"). */
export const OPENROUTER_VENDOR_PREFIXES = ["anthropic/", "openai/", "google/", "deepseek/", "moonshotai/", "z-ai/", "amazon/"] as const;

export function expandLatest<T extends Partial<TierSpec> | undefined>(override: T): T {
  if (!override || override.provider !== undefined || typeof override.model !== "string") return override;
  if (OPENROUTER_VENDOR_PREFIXES.some((p) => override.model!.startsWith(p))) {
    return { ...override, provider: "openrouter" };
  }
  if (!override.model.endsWith("-latest")) return override;
  const e = BY_ALIAS.get(override.model);
  if (!e) {
    throw new Error(
      `createAI: "${override.model}" is not a LATEST family ai-sdk maintains. Known: ${LATEST.map((x) => x.alias).join(", ")}. ` +
        `(A provider's own floating id needs its provider, e.g. override: { provider, model }.)`,
    );
  }
  return { ...override, provider: e.provider, model: e.model };
}
