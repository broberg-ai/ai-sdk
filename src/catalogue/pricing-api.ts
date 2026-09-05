// AI Pricing API (F027) — exact prices for ALL inventory models, callable from the
// installed npm package (no fs, no bun:sqlite → bundles on an edge/browser build).
// Backed by the bundled PRICING_DATA (trimmed inventory.json projection) with the
// curated PRICING table (authoritative routed-provider numbers) overlaid on top.
import { PRICING_DATA, PRICING_GENERATED_AT, PRICING_CHECKED_AT } from "./pricing-data.js";
import { stripDatedSuffix } from "../cost/pricing.js";
import { PRICING } from "../cost/pricing.js";
import { MEDIA_PRICING, MEDIA_PRICING_CHECKED_AT, mediaUnitCounts, type MediaUnit } from "../cost/media-pricing.js";

export type PriceRegion = "eu" | "us" | "cn" | "other";

/** Fields every price row carries, whatever it is billed in. */
export interface BasePrice {
  /** Vendor/provider prefix (e.g. "deepseek", "anthropic"). */
  provider: string;
  /** Model id (OpenRouter-style "vendor/model", or the bare model for curated entries). */
  model: string;
  /** Human label, when known. */
  name?: string;
  /** GDPR region derived from the PROVIDER NAME — a rough grouping, not a residency
   *  claim. It is `"other"` for vertex/bfl/fal/azure precisely because those take a
   *  configurable endpoint, so their region is a property of the CALL and not of the
   *  model. For an actual residency answer use `regionOfHost()` before the call, or
   *  `usage.region` after it. */
  region: PriceRegion;
  /** "curated" = authoritative hand-maintained number; "inventory" = from inventory.json. */
  source: "curated" | "inventory";
  /** ISO date this row was last verified. Media rows carry a HUMAN-set date; token
   *  rows inherit the inventory snapshot's. */
  checkedAt?: string;
}

/** A model billed per token. */
export interface TokenModelPrice extends BasePrice {
  unit: "per_1m_tokens";
  /** USD per 1M input tokens. */
  inputPer1M: number;
  /** USD per 1M output tokens. */
  outputPer1M: number;
  /** Set when this model ALSO carries a non-token price — and that is the one the SDK
   *  bills with (F050.2).
   *
   *  Gemini's image models are the real case: they have honest per-token rates for the
   *  prompt AND a per-image price for the output, and `ai.image` charges the per-image
   *  one. Returning only the token row is not WRONG the way whisper's fabricated $0 was
   *  — the rates are real — it just answers a question nobody asked, and hides the
   *  number that decides the bill. Both are true, so both are here. */
  alsoBilled?: { unit: MediaUnit; usd: number; checkedAt: string };
}

/** A model billed in anything else — per second, image, 1000 chars, minute, page,
 *  or training run (F050.2).
 *
 *  **It deliberately has NO `inputPer1M`.** Until 0.40.0 a media row carried
 *  `inputPer1M: 0`, and super's report named the fault exactly: "a field that does not
 *  apply and a price that is free are the same number again" — the very distinction
 *  `costBasis: "unpriced"` exists for, one storey down. A 0 there is a placeholder that
 *  reads as a price. Splitting the type turns reading it into a COMPILE error instead. */
export interface MediaModelPrice extends BasePrice {
  unit: MediaUnit;
  /** The price, in USD, for one of whatever `unit` names. ALWAYS set on a media row —
   *  read this rather than the unit-specific aliases below. */
  usd: number;
  /** @deprecated Read {@link MediaModelPrice.usd} with {@link MediaModelPrice.unit}.
   *  Kept working because it shipped in 0.40.0 and consumers read it.
   *
   *  USD per second, set ONLY when `unit === "per_sec"` — and DERIVED from `usd`, never
   *  stored twice. super's point, and the precedent is on the fleet's books: two fields
   *  that must be kept equal are not wrong the day they are written, they are wrong the
   *  day one of them is corrected. (torrent-search-api F013.4: a duplicated counter
   *  showed two different numbers a week after the fix landed on one of its two sites.)
   *
   *  It also carries this repo's own scar: 0.40.0 set this-or-`perImage` from a TWO-armed
   *  ternary over SIX units, so every non-per-second price was labelled `perImage` —
   *  `azure:tts` reported `perImage: 0.016` for a price that is per 1000 CHARACTERS. */
  perSec?: number;
  /** @deprecated Read {@link MediaModelPrice.usd} with {@link MediaModelPrice.unit}.
   *  USD per generated image, set ONLY when `unit === "per_image"`, derived from `usd`. */
  perImage?: number;
}

/** A price row. Narrow on `unit` before reading rates:
 *  `if (p.unit === "per_1m_tokens") … else …`. */
export type ModelPrice = TokenModelPrice | MediaModelPrice;

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

/** Media rows as ModelPrice, keyed by lowercased model id.
 *
 *  Deliberately NOT merged into `_list`: `listModelPrices()` / `findModelPrices()`
 *  would then hand a Veo row to a `maxInputPer1M` filter, where its placeholder
 *  `inputPer1M: 0` reads as "free" — a new wrong-layer answer in the middle of
 *  fixing one. Lookup by id is safe (no filter to fool); listing is not. */
let _media: Map<string, MediaModelPrice> | null = null;

function ensureMedia(): Map<string, MediaModelPrice> {
  if (_media) return _media;
  const m = new Map<string, MediaModelPrice>();
  for (const [key, p] of Object.entries(MEDIA_PRICING)) {
    const ci = key.indexOf(":");
    const provider = ci >= 0 ? key.slice(0, ci) : "";
    const model = ci >= 0 ? key.slice(ci + 1) : key;
    // `usd` is the ONE stored price. The unit-specific aliases are DERIVED from the row
    // that already holds it — `row.usd`, not a second read of `p.usd` — so there is no
    // second place a future edit could set differently. (F050.3, super's point.)
    //
    // The two-armed ternary this replaced sent every non-per-second price out as
    // `perImage`: six units through a two-way branch, written when there were only two
    // units and never revisited when F050 grew the table to six.
    const row: MediaModelPrice = {
      provider,
      model,
      unit: p.unit,
      usd: p.usd,
      checkedAt: p.checkedAt,
      region: regionForProvider(provider),
      source: "curated",
    };
    if (row.unit === "per_sec") row.perSec = row.usd;
    if (row.unit === "per_image") row.perImage = row.usd;
    // The fully-qualified key always wins for itself; the BARE alias is first-write.
    // Veo lives under both gemini and vertex with identical numbers, so a bare lookup
    // can only name one provider — last-write-wins made that answer arbitrary (it was
    // "vertex" purely because of spread order). First-write pins it to the consumer
    // Gemini API, and anyone who means the other one asks for "vertex:<model>".
    if (!m.has(model.toLowerCase())) m.set(model.toLowerCase(), row);
    m.set(key.toLowerCase(), row);
  }
  _media = m;
  return m;
}

/** Every non-token price the SDK bills from (F050). Separate from
 *  {@link listModelPrices} because the two answer different questions and mixing
 *  them silently changed what an existing caller's list meant. */
export function listMediaPrices(): MediaModelPrice[] {
  return [...new Set(ensureMedia().values())];
}

let _list: TokenModelPrice[] | null = null;
let _full: Map<string, TokenModelPrice> | null = null;
let _base: Map<string, TokenModelPrice> | null = null;

function ensure(): void {
  // BEFORE the early return, so every lookup path reaches it — not only the first one
  // that happened to build the table. The once-per-process guard lives in the warner.
  warnIfPricingStale();
  if (_list) return;
  const list: TokenModelPrice[] = [];
  const byBase = new Map<string, TokenModelPrice>();
  for (const r of PRICING_DATA) {
    const e: TokenModelPrice = {
      provider: r.provider,
      model: r.model,
      name: r.name,
      inputPer1M: r.input,
      outputPer1M: r.output,
      unit: "per_1m_tokens",
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
      const e: TokenModelPrice = {
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
  // A model can be BOTH token- and media-priced (Gemini's image models: real per-token
  // rates for the prompt, a per-image price for the output that ai.image actually
  // charges). Attach rather than choose — picking either one alone answers half the
  // question, and it is the half nobody asked that used to win.
  for (const [key, mp] of Object.entries(MEDIA_PRICING)) {
    const model = key.slice(key.indexOf(":") + 1).toLowerCase();
    const tok = _full.get(model) ?? byBase.get(basename(model));
    if (tok) tok.alsoBilled = { unit: mp.unit, usd: mp.usd, checkedAt: mp.checkedAt };
  }
}

/** Exact price for a model. `modelId` accepts "vendor/model", "provider:model", or a
 *  bare model/basename. Returns undefined if unknown. */
export function getModelPrice(modelId: string): ModelPrice | undefined {
  ensure();
  const s = modelId.trim().toLowerCase();
  // The dated-snapshot fallback is LAST, after every exact form, so a provider that
  // genuinely prices a dated snapshot differently keeps its own row.
  const dated = stripDatedSuffix(s);
  const media = ensureMedia();
  return (
    _full!.get(s) ??
    (s.includes(":") ? _full!.get(s.slice(s.indexOf(":") + 1)) : undefined) ??
    _base!.get(basename(s)) ??
    (dated !== s ? (_full!.get(dated) ?? _base!.get(basename(dated))) : undefined) ??
    // Media LAST, so a token model never loses its own row to a media id collision.
    // Before F050 this returned undefined for every video model, which a caller could
    // not tell apart from "we have no price for that anywhere".
    media.get(s) ??
    (s.includes(":") ? media.get(s.slice(s.indexOf(":") + 1)) : undefined)
  );
}

/** Every known model price (inventory, with the curated overlay applied). */
export function listModelPrices(): TokenModelPrice[] {
  ensure();
  return _list!.slice();
}

/** Filter the price list (provider / region / max input rate / free-only). */
export function findModelPrices(filter: PriceFilter = {}): TokenModelPrice[] {
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

/** Freshness of ONE pricing unit. */
export interface UnitFreshness {
  unit: string;
  /** How many rows the table holds in this unit. Zero means NOT COVERED — which is
   *  a different answer from "covered and fresh", and used to be indistinguishable. */
  count: number;
  /** When a check last happened for this unit. Empty = never. */
  checkedAt: string;
  ageDays: number | null;
  stale: boolean;
}

export interface PricingFreshness {
  /** When the numbers last CHANGED. */
  generatedAt: string;
  /** When we last VERIFIED them against the live catalogue. Empty on a pre-F046
   *  snapshot, which means "we cannot say" — never "fresh". */
  checkedAt: string;
  /** Days since `checkedAt`; `null` when there is no check date to measure from. */
  ageDays: number | null;
  /** True when the check is older than {@link PRICING_STALE_AFTER_DAYS} — or when
   *  there is no check date at all. An unanswerable question is not a pass.
   *
   *  **Scope: the TOKEN table only.** Unchanged from F046 on purpose — consumers and
   *  the release guard already read it. For "is anything I might bill for covered?",
   *  read {@link PricingFreshness.caveats}. */
  stale: boolean;
  thresholdDays: number;
  /** Per-unit breakdown (F050). Every unit the SDK can bill in, whether or not the
   *  table has rows for it — an absent unit must show up as `count: 0`, not as an
   *  absent key that a caller iterating the object would never notice. */
  units: UnitFreshness[];
  /** Human-readable reservations, one per unit that is uncovered or stale.
   *
   *  This is the field that makes `stale: false` honest. super measured the state it
   *  exists to end: `{ageDays: 0, stale: false}` on a table where per-second prices
   *  could not exist, so the API built to catch price drift reported "fresh" about
   *  numbers it structurally could not see. Empty array = no reservations. */
  caveats: string[];
}

/** What {@link computeFreshness} needs to judge a unit. Supplied by
 *  {@link pricingFreshness} from the real tables; a test passes its own. */
export interface UnitInput {
  unit: string;
  count: number;
  checkedAt: string;
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
  units: UnitInput[] = [],
): PricingFreshness {
  const age = (iso: string): number | null => {
    const t = iso ? Date.parse(iso) : NaN;
    // Clamped at 0. A date-only stamp parses as UTC midnight, so a check made TODAY in
    // Copenhagen (UTC+1/+2) reads as tomorrow for the first hours of the day and the
    // raw subtraction floors to -1. "-1 days old" is not wrong in a way that endangers
    // anything, but it is a number no reader can act on. 0 is the true answer: it was
    // checked today.
    return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 86_400_000)) : null;
  };
  // No check date → stale. The absent case must not read as the healthy one; that is
  // the whole failure this feature exists to remove.
  const isStale = (d: number | null) => d === null || d > PRICING_STALE_AFTER_DAYS;

  const ageDays = age(checkedAt);
  const unitRows: UnitFreshness[] = units.map((u) => {
    const a = age(u.checkedAt);
    return { unit: u.unit, count: u.count, checkedAt: u.checkedAt, ageDays: a, stale: isStale(a) };
  });

  // A unit with NO rows outranks a stale one in the message: "we have never priced
  // this" and "our price is old" call for different actions from the reader.
  const caveats = unitRows.flatMap((u) =>
    u.count === 0
      ? [`${u.unit}: 0 rows — this table cannot price anything billed in ${u.unit}, so "stale: false" says nothing about it`]
      : u.stale
        ? [
            `${u.unit}: ${u.count} row(s) last verified ${u.checkedAt || "never"}` +
              (u.ageDays === null ? "" : ` (${u.ageDays} days ago)`) +
              `, past the ${PRICING_STALE_AFTER_DAYS}d threshold`,
          ]
        : [],
  );

  return {
    generatedAt,
    checkedAt,
    ageDays,
    stale: isStale(ageDays),
    thresholdDays: PRICING_STALE_AFTER_DAYS,
    units: unitRows,
    caveats,
  };
}

export function pricingFreshness(nowMs: number = Date.now()): PricingFreshness {
  return computeFreshness(PRICING_GENERATED_AT, PRICING_CHECKED_AT, nowMs, [
    { unit: "per_1m_tokens", count: PRICING_DATA.length, checkedAt: PRICING_CHECKED_AT },
    // Every media unit, derived from the table rather than listed here — a unit added
    // to MEDIA_PRICING and forgotten here would be a unit the freshness API silently
    // does not report, which is this whole feature's own bug wearing a new hat.
    // Hand-maintained, and the monthly job cannot reach them, hence their own date:
    // inheriting the token snapshot's would make an un-revised video price look freshly
    // verified every time the token job ran.
    ...Object.entries(mediaUnitCounts()).map(([unit, count]) => ({
      unit,
      count,
      checkedAt: MEDIA_PRICING_CHECKED_AT,
    })),
  ]);
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
  // F050 — the caveats are a REASON TO WARN in their own right, not decoration on a
  // warning that already fired. A table can be perfectly fresh on tokens and blind to
  // every per-second price in it, which is the exact state that shipped for months.
  if (!f.stale && f.caveats.length === 0) return;
  warned = true;
  // ONE console.warn, however many things are wrong. A library that prints eight lines
  // on first use gets silenced, and a silenced warning is the state we started from —
  // the same reasoning as warning once rather than per lookup, one level up.
  const parts: string[] = [];
  if (f.stale) {
    const age = f.ageDays === null ? "of unknown age" : `${f.ageDays} days old`;
    parts.push(
      `price table is ${age} (last verified ${f.checkedAt || "never"}, threshold ` +
        `${f.thresholdDays}d). Prices drift: one week has produced 34 changes before. ` +
        `Refresh with \`bun run scripts/build-inventory.ts\` in ai-sdk, or take a newer release.`,
    );
  }
  if (f.caveats.length > 0) {
    parts.push(
      `${f.caveats.length} pricing caveat(s): ${f.caveats.join("; ")}. Non-token prices are ` +
        `HAND-maintained (no vendor catalogue API serves them), so refreshing them means a ` +
        `human re-reading the vendor's pricing page and bumping MEDIA_PRICING_CHECKED_AT in ` +
        `src/cost/media-pricing.ts.`,
    );
  }
  console.warn(`[@broberg/ai-sdk] ${parts.join(" | ")}`);
}

/** Test-only: forget that we already warned. */
export function resetPricingWarningForTests(): void {
  warned = false;
}
