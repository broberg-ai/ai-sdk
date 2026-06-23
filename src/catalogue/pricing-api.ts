// AI Pricing API (F027) — exact prices for ALL inventory models, callable from the
// installed npm package (no fs, no bun:sqlite → bundles on an edge/browser build).
// Backed by the bundled PRICING_DATA (trimmed inventory.json projection) with the
// curated PRICING table (authoritative routed-provider numbers) overlaid on top.
import { PRICING_DATA, PRICING_GENERATED_AT } from "./pricing-data.js";
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
  return (
    _full!.get(s) ??
    (s.includes(":") ? _full!.get(s.slice(s.indexOf(":") + 1)) : undefined) ??
    _base!.get(basename(s))
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

/** ISO timestamp of the inventory snapshot these prices came from — for staleness checks. */
export function pricingGeneratedAt(): string {
  return PRICING_GENERATED_AT;
}
