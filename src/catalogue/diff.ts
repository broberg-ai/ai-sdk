// F014 — diff the live provider catalogue against the SDK's hand-maintained
// pricing table (src/cost/pricing.ts) + default routes (src/routing/tier-map.ts).
//
// Four buckets, each from a distinct source so they don't overlap:
//  • added            — direct-provider models of a brand we already track, not
//                       yet in PRICING (new snapshots to add; also catches the
//                       v0.5.1 prefix bug where the correct key was missing).
//  • missingPrice     — a DEFAULT_TIER_MAP route that getPrice() can't price →
//                       it would log $0. The hard regression guard (zero noise).
//  • priceChanged     — a PRICING entry whose upstream price (OpenRouter) has
//                       drifted past the threshold.
//  • removedUpstream  — a PRICING key for a cleanly-fetched provider whose model
//                       is no longer listed upstream (renamed / retired).
import { PRICING, getPrice } from "../cost/pricing.js";
import { MEDIA_PRICING } from "../cost/media-pricing.js";
import { DEFAULT_TIER_MAP } from "../routing/tier-map.js";
import { allEntries } from "../availability/registry.js";
import { ROUTED_SPECS } from "../client.js";
import { catalogueKey, type CatalogueModel } from "./types.js";

export interface PriceChange {
  key: string;
  ourInputPer1M: number;
  ourOutputPer1M: number;
  upstreamInputPer1M?: number;
  upstreamOutputPer1M?: number;
}

export interface CatalogueDiff {
  added: CatalogueModel[];
  missingPrice: string[];
  priceChanged: PriceChange[];
  removedUpstream: string[];
}

/** Brand token: "claude-haiku-4-5" → "claude", "gpt-4o-mini" → "gpt",
 *  "google/gemini-2.5-flash" → "gemini". The coarse family we match new models against. */
function brandToken(model: string): string {
  const tail = model.split("/").pop() ?? model;
  return tail.split("-")[0] ?? tail;
}

const DIRECT_PROVIDERS = new Set(["openai", "anthropic", "gemini"]);

/** F067.1 — providers whose WHOLE list is reported: every model nothing in the SDK
 *  knows is "added". Their lists are short (or, for Mistral, collapse into alias
 *  groups), so there is no brand filter to hide behind — the filter is why a speech
 *  model could never appear: ElevenLabs has no token price, so it had no "brand". */
const FULL_LIST_PROVIDERS = new Set(["mistral", "deepseek", "elevenlabs"]);

/** Every `${provider}:${model}` the SDK already prices, tracks or routes to. */
function knownKeys(): Set<string> {
  const known = new Set<string>([...Object.keys(PRICING), ...Object.keys(MEDIA_PRICING)]);
  for (const e of allEntries()) known.add(`${e.provider}:${e.id}`);
  for (const spec of [...Object.values(DEFAULT_TIER_MAP), ...ROUTED_SPECS]) known.add(`${spec.provider}:${spec.model}`);
  return known;
}

export function diffCatalogue(
  fetched: CatalogueModel[],
  opts: { fetchedProviders?: string[]; priceThreshold?: number } = {},
): CatalogueDiff {
  const threshold = opts.priceThreshold ?? 0.01; // 1% relative drift
  const fetchedProviders = new Set(opts.fetchedProviders ?? fetched.map((m) => m.provider));

  // Indexed by id AND every alias, so a priced alias (mistral-large-latest) is not
  // reported as gone just because the provider lists it as an alias of a dated id.
  const fetchedByKey = new Map<string, CatalogueModel>();
  for (const m of fetched) {
    fetchedByKey.set(catalogueKey(m), m);
    for (const a of m.aliases ?? []) {
      const k = catalogueKey({ provider: m.provider, model: a });
      if (!fetchedByKey.has(k)) fetchedByKey.set(k, m);
    }
  }
  const known = knownKeys();

  // Brands we already track, per provider (derived from the priced table).
  const trackedBrands = new Map<string, Set<string>>();
  for (const key of Object.keys(PRICING)) {
    const [provider, model] = splitKey(key);
    if (!trackedBrands.has(provider)) trackedBrands.set(provider, new Set());
    trackedBrands.get(provider)!.add(brandToken(model));
  }

  // ── added ────────────────────────────────────────────────────────────
  const added: CatalogueModel[] = [];
  const reportedGroups = new Set<string>();
  for (const m of fetched) {
    if (FULL_LIST_PROVIDERS.has(m.provider)) {
      if (m.deprecated) continue;
      const group = [m.model, ...(m.aliases ?? [])].map((id) => catalogueKey({ provider: m.provider, model: id }));
      if (group.some((k) => known.has(k) || reportedGroups.has(k))) continue;
      for (const k of group) reportedGroups.add(k);
      added.push(m);
      continue;
    }
    if (!DIRECT_PROVIDERS.has(m.provider)) continue; // openrouter's full list is too broad to mine for adds
    const brands = trackedBrands.get(m.provider);
    if (!brands?.has(brandToken(m.model))) continue; // only brands we already price
    if (PRICING[catalogueKey(m)]) continue; // already priced
    added.push(m);
  }

  // ── missingPrice (hard guard over the SDK's shipped routes) ───────────
  const missingPrice: string[] = [];
  for (const spec of Object.values(DEFAULT_TIER_MAP)) {
    if (!getPrice(spec.provider, spec.model)) missingPrice.push(`${spec.provider}:${spec.model}`);
  }

  // ── priceChanged + removedUpstream (over the priced table) ────────────
  const priceChanged: PriceChange[] = [];
  const removedUpstream: string[] = [];
  for (const [key, entry] of Object.entries(PRICING)) {
    const [provider] = splitKey(key);
    if (!fetchedProviders.has(provider)) continue; // can't judge a provider we didn't fetch

    const up = fetchedByKey.get(key);
    if (!up) {
      removedUpstream.push(key);
      continue;
    }
    if (up.inputPer1M === undefined && up.outputPer1M === undefined) continue; // list-only source, no price to compare
    const inDrift = relDrift(entry.inputPer1M, up.inputPer1M);
    const outDrift = relDrift(entry.outputPer1M, up.outputPer1M);
    if (inDrift > threshold || outDrift > threshold) {
      priceChanged.push({
        key,
        ourInputPer1M: entry.inputPer1M,
        ourOutputPer1M: entry.outputPer1M,
        ...(up.inputPer1M !== undefined ? { upstreamInputPer1M: up.inputPer1M } : {}),
        ...(up.outputPer1M !== undefined ? { upstreamOutputPer1M: up.outputPer1M } : {}),
      });
    }
  }

  return { added, missingPrice, priceChanged, removedUpstream };
}

/** Relative drift between our price and upstream's; 0 when upstream omits the price. */
function relDrift(ours: number, upstream: number | undefined): number {
  if (upstream === undefined) return 0;
  if (upstream === 0) return ours === 0 ? 0 : Infinity;
  return Math.abs(ours - upstream) / upstream;
}

/** Split a `${provider}:${model}` key, keeping any colons inside the model (none today, but safe). */
function splitKey(key: string): [string, string] {
  const i = key.indexOf(":");
  return [key.slice(0, i), key.slice(i + 1)];
}
