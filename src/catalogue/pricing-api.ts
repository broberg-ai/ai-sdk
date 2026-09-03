// AI Pricing API (F027) — exact prices for ALL inventory models, callable from the
// installed npm package (no fs, no bun:sqlite → bundles on an edge/browser build).
// Backed by the bundled PRICING_DATA (trimmed inventory.json projection) with the
// curated PRICING table (authoritative routed-provider numbers) overlaid on top.
import { PRICING_DATA, PRICING_GENERATED_AT, PRICING_CHECKED_AT } from "./pricing-data.js";
import { stripDatedSuffix } from "../cost/pricing.js";
import { PRICING } from "../cost/pricing.js";

export type PriceRegion = "eu" | "us" | "cn" | "other";

export interface ModelPrice {
  /** Vendor/provider prefix (e.g. "deepseek", "anthropic"). */
  provider: string;
  /** Model id (OpenRouter-style "vendor/model", or the bare model for curated entries). */
  model: string;
  /** Human label, when known. */
  name?: string;
  /** USD per 1M input tokens. */
  inputPer1M: number;
  /** USD per 1M output tokens. */
  outputPer1M: number;
  /** Pricing unit (almost always "per_1m_tokens"). */
  unit: string;
  /** GDPR region of the host. */
  region: PriceRegion;
  /** "curated" = authoritative hand-maintained number; "inventory" = from inventory.json. */
  source: "curated" | "inventory";
}

export interface PriceFilter {
  provider?: string;
  region?: PriceRegion;
  /** Only models at/under this USD-per-1M input rate. */
  maxInputPer1M?: number;
  /** Only $0/$0 models when true; only paid when false. */
  free?: boolean;
}

/** Final model token: strip an optional "provider:" prefix, then an optional "vendor/" path. */
const basename = (id: string): string => {
  let s = id.toLowerCase();
  const colon = s.lastIndexOf(":");
  if (colon >= 0) s = s.slice(colon + 1);
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1);
  return s;
};

/** Region for a curated-only entry whose vendor isn't in the inventory. */
function regionForProvider(provider: string): PriceRegion {
  switch (provider) {
    case "mistral":
    case "mistralai":
      return "eu";
    case "deepseek":
      return "cn";
    case "anthropic":
    case "openai":
    case "google":
    case "x-ai":
    case "meta-llama":
      return "us";
    default:
      return "other";
  }
}

let _list: ModelPrice[] | null = null;
let _full: Map<string, ModelPrice> | null = null;
let _base: Map<string, ModelPrice> | null = null;

function ensure(): void {
  // BEFORE the early return, so every lookup path reaches it — not only the first one
  // that happened to build the table. The once-per-process guard lives in the warner.
  warnIfPricingStale();
  if (_list) return;
  const list: ModelPrice[] = [];
  const byBase = new Map<string, ModelPrice>();
  for (const r of PRICING_DATA) {
    const e: ModelPrice = {
      provider: r.provider,
      model: r.model,
      name: r.name,
      inputPer1M: r.input,
      outputPer1M: r.output,
      unit: r.unit,
      region: (["eu", "us", "cn", "other"].includes(r.region) ? r.region : "other") as PriceRegion,
      source: "inventory",
    };
    list.push(e);
    byBase.set(basename(r.model), e);
  }
  // Overlay the curated table (authoritative). Match on model basename; add if new.
  for (const [key, p] of Object.entries(PRICING)) {
    const ci = key.indexOf(":");
    const provider = ci >= 0 ? key.slice(0, ci) : "";
    const modelPart = ci >= 0 ? key.slice(ci + 1) : key;
    const existing = byBase.get(basename(modelPart));
    if (existing) {
      existing.inputPer1M = p.inputPer1M;
      existing.outputPer1M = p.outputPer1M;
      existing.unit = "per_1m_tokens";
      existing.source = "curated";
    } else {
      const e: ModelPrice = {
        provider,
        model: modelPart,
        inputPer1M: p.inputPer1M,
        outputPer1M: p.outputPer1M,
        unit: "per_1m_tokens",
        region: regionForProvider(provider),
        source: "curated",
      };
      list.push(e);
      byBase.set(basename(modelPart), e);
    }
  }
  _list = list;
  _base = byBase;
  _full = new Map(list.map((e) => [e.model.toLowerCase(), e]));
}

/** Exact price for a model. `modelId` accepts "vendor/model", "provider:model", or a
 *  bare model/basename. Returns undefined if unknown. */
export function getModelPrice(modelId: string): ModelPrice | undefined {
  ensure();
  const s = modelId.trim().toLowerCase();
  // The dated-snapshot fallback is LAST, after every exact form, so a provider that
  // genuinely prices a dated snapshot differently keeps its own row.
  const dated = stripDatedSuffix(s);
  return (
    _full!.get(s) ??
    (s.includes(":") ? _full!.get(s.slice(s.indexOf(":") + 1)) : undefined) ??
    _base!.get(basename(s)) ??
    (dated !== s ? (_full!.get(dated) ?? _base!.get(basename(dated))) : undefined)
  );
}

/** Every known model price (inventory, with the curated overlay applied). */
export function listModelPrices(): ModelPrice[] {
  ensure();
  return _list!.slice();
}

/** Filter the price list (provider / region / max input rate / free-only). */
export function findModelPrices(filter: PriceFilter = {}): ModelPrice[] {
  return listModelPrices().filter((m) => {
    if (filter.provider && m.provider !== filter.provider) return false;
    if (filter.region && m.region !== filter.region) return false;
    if (filter.maxInputPer1M != null && m.inputPer1M > filter.maxInputPer1M) return false;
    if (filter.free === true && (m.inputPer1M !== 0 || m.outputPer1M !== 0)) return false;
    if (filter.free === false && m.inputPer1M === 0 && m.outputPer1M === 0) return false;
    return true;
  });
}

/** Convenience USD compute for a token-priced model; undefined if unknown / not token-priced. */
export function priceCall(modelId: string, inputTokens: number, outputTokens: number): number | undefined {
  const p = getModelPrice(modelId);
  if (!p || p.unit !== "per_1m_tokens") return undefined;
  return (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
}

/** ISO timestamp of the inventory snapshot these prices came from.
 *
 *  **This is when the NUMBERS LAST MOVED, not when we last checked them** — so it is
 *  the wrong field to measure staleness with. Use {@link pricingFreshness}. Kept as-is
 *  because consumers already call it and its value has not changed meaning. */
export function pricingGeneratedAt(): string {
  return PRICING_GENERATED_AT;
}

/** How old a price check may be before we call it stale.
 *
 *  ONE constant: the `model-advisor` skill quotes the same number, and two copies of a
 *  threshold drift apart until the doc and the code disagree about what "stale" means. */
export const PRICING_STALE_AFTER_DAYS = 35;

export interface PricingFreshness {
  /** When the numbers last CHANGED. */
  generatedAt: string;
  /** When we last VERIFIED them against the live catalogue. Empty on a pre-F046
   *  snapshot, which means "we cannot say" — never "fresh". */
  checkedAt: string;
  /** Days since `checkedAt`; `null` when there is no check date to measure from. */
  ageDays: number | null;
  /** True when the check is older than {@link PRICING_STALE_AFTER_DAYS} — or when
   *  there is no check date at all. An unanswerable question is not a pass. */
  stale: boolean;
  thresholdDays: number;
}

/** Is this price table still worth trusting? (F046)
 *
 *  Measured from `checkedAt`, deliberately. Prices drift fast — one week between two
 *  rebuilds produced 34 price changes, 23 new models and 15 removals, and
 *  `google/gemini-3.7-flash` doubled — so a table nobody has verified is a table that
 *  quietly bills the wrong number. */
/** The pure computation, exported so a test can hand it two dates that are FAR APART.
 *
 *  Without this seam the only available dates are the shipped constants, and those sit
 *  seconds apart on a freshly rebuilt inventory — so a test asserting "we measure from
 *  checkedAt" would pass just as happily on an implementation that measured from
 *  generatedAt. Green because the data was friendly, which is the fault this whole
 *  feature is about. */
export function computeFreshness(
  generatedAt: string,
  checkedAt: string,
  nowMs: number,
): PricingFreshness {
  const t = checkedAt ? Date.parse(checkedAt) : NaN;
  const ageDays = Number.isFinite(t) ? Math.floor((nowMs - t) / 86_400_000) : null;
  return {
    generatedAt,
    checkedAt,
    ageDays,
    // No check date → stale. The absent case must not read as the healthy one; that is
    // the whole failure this feature exists to remove.
    stale: ageDays === null || ageDays > PRICING_STALE_AFTER_DAYS,
    thresholdDays: PRICING_STALE_AFTER_DAYS,
  };
}

export function pricingFreshness(nowMs: number = Date.now()): PricingFreshness {
  return computeFreshness(PRICING_GENERATED_AT, PRICING_CHECKED_AT, nowMs);
}

let warned = false;
/** Warn ONCE per process that these prices are old. Called from every price lookup.
 *
 *  Once, not per lookup: a library that prints on every call in a loop gets silenced,
 *  and a silenced warning is the state we started from. Opt out with
 *  `BROBERG_AI_SDK_SILENCE_PRICING_WARNING=1` — offered so that a consumer who does not
 *  want the noise turns off the WARNING rather than abandoning the lookup. */
export function warnIfPricingStale(nowMs: number = Date.now()): void {
  if (warned) return;
  if (globalThis.process?.env?.BROBERG_AI_SDK_SILENCE_PRICING_WARNING) return;
  const f = pricingFreshness(nowMs);
  if (!f.stale) return;
  warned = true;
  const age = f.ageDays === null ? "of unknown age" : `${f.ageDays} days old`;
  console.warn(
    `[@broberg/ai-sdk] price table is ${age} (last verified ${f.checkedAt || "never"}, ` +
      `threshold ${f.thresholdDays}d). Prices drift: one week has produced 34 changes before. ` +
      `Refresh with \`bun run scripts/build-inventory.ts\` in ai-sdk, or take a newer release.`,
  );
}

/** Test-only: forget that we already warned. */
export function resetPricingWarningForTests(): void {
  warned = false;
}
