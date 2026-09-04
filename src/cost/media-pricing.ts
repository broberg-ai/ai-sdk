// Per-SECOND and per-IMAGE prices (F050) — the media half of the price table.
//
// Why this file exists at all. Until F050 these numbers lived as four private
// `const` tables inside four adapters (gemini, vertex, fal, bfl). super measured
// the consequence against 0.38.0: `pricingFreshness()` answered `{stale:false}`
// while the table it measures is `per_1m_tokens` on all 448 rows — so the API
// built to catch price drift reported "fresh" about numbers it structurally could
// not see, and `getModelPrice("veo-3.1-generate-preview")` was `undefined`. From
// a call site, "covered and fresh" and "not covered at all" looked identical.
//
// These prices are HAND-MAINTAINED and the monthly job cannot refresh them: the
// vendors publish them on marketing pages, not in a catalogue API (OpenRouter,
// which backs the token table, carries no video or image model). That is exactly
// why `checkedAt` here is a date a HUMAN typed, and why it is a separate field
// rather than inherited from the token snapshot — an inherited date would make an
// un-revised number look freshly verified every time the token job ran.
//
// The numbers themselves are UNCHANGED by this move, on purpose (F050 non-goal):
// Veo $0.40/s and Kling $0.07/s were independently confirmed by super on 0.38.0,
// and a refactor that silently repriced a call would be a worse bug than the
// blindness it fixes. A test pins them.

/** A price that is not per-token.
 *
 *  Six units, not the two F050 was carded for. The form-forbidding test found ten
 *  MORE hand-written price constants than super's report named — speech billed per
 *  1000 characters, transcription per audio-minute, OCR per page, a flat LoRA
 *  training fee, and two more per-image tables. Moving only the four that had been
 *  noticed would have left `caveats` reporting "covered" while four other units sat
 *  in four adapters' private constants: the same blindness, one unit along. */
export type MediaUnit = "per_sec" | "per_image" | "per_1k_chars" | "per_min" | "per_page" | "per_training";

export interface MediaPrice {
  unit: MediaUnit;
  /** USD per second (video) or per generated image. */
  usd: number;
  /** ISO date a HUMAN last checked this against the vendor's published price.
   *  Not derived from the monthly token job — that job never sees these. */
  checkedAt: string;
  /** Where the number comes from, so the next person can re-check it. */
  source: string;
}

/** When a human last walked the whole media table against vendor pricing pages.
 *
 *  ONE date for the table rather than trusting every row's own: a row added later
 *  with a fresh date would otherwise pull the table's average forward while the
 *  older rows sat unrevised. Freshness reads the OLDEST answer, and this is it. */
export const MEDIA_PRICING_CHECKED_AT = "2026-09-05";

/** Veo per-second USD. Same model family and the same rates on the consumer
 *  Gemini API and on Vertex — one object, registered under both providers, so a
 *  correction cannot land on one route and miss the other. */
const VEO_PER_SEC: Record<string, { usd: number; source: string }> = {
  "veo-3.1-generate-preview": { usd: 0.4, source: "ai.google.dev/gemini-api/docs/pricing — video with audio, 720p/1080p (4K = 0.60)" },
  "veo-3.1-fast-generate-preview": { usd: 0.1, source: "ai.google.dev/gemini-api/docs/pricing — 720p (1080p = 0.12, 4K = 0.30)" },
  "veo-3.1-lite-generate-preview": { usd: 0.05, source: "ai.google.dev/gemini-api/docs/pricing — 720p (1080p = 0.08)" },
  "veo-3.0-generate-001": { usd: 0.4, source: "ai.google.dev/gemini-api/docs/pricing" },
  "veo-3.0-fast-generate-001": { usd: 0.1, source: "ai.google.dev/gemini-api/docs/pricing" },
};

const veoRows = (provider: string): Record<string, MediaPrice> =>
  Object.fromEntries(
    Object.entries(VEO_PER_SEC).map(([model, v]) => [
      `${provider}:${model}`,
      { unit: "per_sec" as const, usd: v.usd, checkedAt: MEDIA_PRICING_CHECKED_AT, source: v.source },
    ]),
  );

/** Every non-token price the SDK bills from, keyed `provider:model`. */
export const MEDIA_PRICING: Record<string, MediaPrice> = {
  ...veoRows("gemini"),
  ...veoRows("vertex"),

  // fal video — fal's OFFICIAL published per-second rate, not a guess. Kling 2.5
  // Turbo Pro i2v is the blessed FAL_KEY-only image→video route: $0.35 for the
  // first 5 s + $0.07/additional s = a flat $0.07/s at 1080p.
  "fal:fal-ai/kling-video/v2.5-turbo/pro/image-to-video": {
    unit: "per_sec",
    usd: 0.07,
    checkedAt: MEDIA_PRICING_CHECKED_AT,
    source: "fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  },

  // fal images — ESTIMATES. fal bills by megapixel and changes often; fal returns
  // no price with the result, so a call costed from these carries
  // `costBasis: "estimated"`. Override per call with config.pricePerImage.
  "fal:fal-ai/flux/schnell": { unit: "per_image", usd: 0.003, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "fal.ai pricing — estimate, billed by megapixel" },
  "fal:fal-ai/flux/dev": { unit: "per_image", usd: 0.025, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "fal.ai pricing — estimate, billed by megapixel" },
  "fal:fal-ai/flux-lora": { unit: "per_image", usd: 0.025, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "fal.ai pricing — estimate, billed by megapixel" },
  "fal:fal-ai/flux-pro": { unit: "per_image", usd: 0.05, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "fal.ai pricing — estimate, billed by megapixel" },
  "fal:fal-ai/flux-pro/v1.1": { unit: "per_image", usd: 0.04, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "fal.ai pricing — estimate, billed by megapixel" },

  // BFL — the fallback only. BFL RETURNS the real billed cost in credits, so a
  // normal call is `costBasis: "reported"` and never reads this row.
  "bfl:flux-pro-1.1-ultra-finetuned": {
    unit: "per_image",
    usd: 0.06,
    checkedAt: MEDIA_PRICING_CHECKED_AT,
    source: "bfl.ai/pricing — estimate; used only when BFL omits the credit cost",
  },

  // Gemini images — billed per image, not per token. Google's price RISES with
  // resolution; these are the common 1K/1024px default.
  "gemini:gemini-2.5-flash-image": { unit: "per_image", usd: 0.039, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "ai.google.dev/gemini-api/docs/pricing — 'nano-banana', 1024px = 1290 tok" },
  "gemini:gemini-3.1-flash-image": { unit: "per_image", usd: 0.067, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "ai.google.dev/gemini-api/docs/pricing — 1K; 2K=0.101, 4K=0.151" },
  "gemini:gemini-3.1-flash-image-preview": { unit: "per_image", usd: 0.067, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "ai.google.dev/gemini-api/docs/pricing — 1K; 2K=0.101, 4K=0.151" },
  "gemini:gemini-3-pro-image": { unit: "per_image", usd: 0.134, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "ai.google.dev/gemini-api/docs/pricing — premium; 1K/2K=0.134, 4K=0.24" },
  "gemini:gemini-3-pro-image-preview": { unit: "per_image", usd: 0.134, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "ai.google.dev/gemini-api/docs/pricing — premium; was mistakenly the flash price once" },

  // OpenRouter images — the FALLBACK only. OpenRouter usually returns usage.cost.
  "openrouter:recraft/recraft-v4.1": { unit: "per_image", usd: 0.035, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "openrouter.ai/recraft/recraft-v4.1 — fallback when usage.cost is omitted" },
  "openrouter:recraft/recraft-v4.1-vector": { unit: "per_image", usd: 0.08, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "openrouter.ai/recraft/recraft-v4.1-vector — fallback when usage.cost is omitted" },

  // Speech OUT — billed per 1000 characters of input text.
  "azure:tts": { unit: "per_1k_chars", usd: 0.016, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "azure.microsoft.com/pricing — neural standard, $16/1M chars" },
  "elevenlabs:tts": { unit: "per_1k_chars", usd: 0.15, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "elevenlabs.io/pricing — API overage approx $0.10-0.18/1k chars; ESTIMATE" },

  // Translation — per 1000 characters. Free tier (":fx" key, within quota) is truly $0;
  // this rate only bites past the Pro allowance.
  "deepl:translate": { unit: "per_1k_chars", usd: 0.0217, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "deepl.com/pro-api — ESTIMATE, conflicting tier reports; verify before a budget decision" },

  // Speech IN — billed per audio-minute.
  "azure:stt": { unit: "per_min", usd: 0.0167, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "azure.microsoft.com/pricing — standard STT, $1/audio-hour" },
  "openai:whisper-1": { unit: "per_min", usd: 0.006, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "openai.com/api/pricing — Whisper" },
  "mistral:voxtral-mini-latest": { unit: "per_min", usd: 0.002, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "mistral.ai/pricing — Voxtral" },
  "mistral:voxtral-mini-2507": { unit: "per_min", usd: 0.002, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "mistral.ai/pricing — Voxtral" },
  "mistral:voxtral-mini-2602": { unit: "per_min", usd: 0.002, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "mistral.ai/pricing — Voxtral" },

  // OCR — per page.
  "mistral:ocr": { unit: "per_page", usd: 0.002, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "mistral.ai/pricing — OCR, $2/1000 pages" },

  // A flat fee per training run, not per anything produced.
  "fal:train": { unit: "per_training", usd: 2.0, checkedAt: MEDIA_PRICING_CHECKED_AT, source: "fal.ai/models/fal-ai/flux-lora-fast-training — approx $2, ESTIMATE" },
};

/** Default clip length billed when the caller passes no `durationSec`.
 *
 *  It is an ASSUMPTION, not a measurement — the provider does not tell us how long
 *  the clip it returned actually is. Every cost derived from it is stamped
 *  `costBasis: "estimated"` so a consumer (and upmetrics) can tell it apart from a
 *  cost computed off a real duration. super reported using such a number as if it
 *  were measured and passing it on to Christian; that is the damage this stamp
 *  removes. */
export const DEFAULT_CLIP_SEC = 8;

/** Look up a non-token price. Unknown → undefined (never a fabricated 0). */
export function getMediaPrice(provider: string, model: string): MediaPrice | undefined {
  return MEDIA_PRICING[`${provider}:${model}`];
}

/** Rows per unit, for the freshness API's coverage report. */
export function mediaUnitCounts(): Record<MediaUnit, number> {
  // Every unit listed explicitly, so one that loses its last row reports 0 rather
  // than vanishing from the object — an absent key is what a caller never notices.
  const counts: Record<MediaUnit, number> = {
    per_sec: 0,
    per_image: 0,
    per_1k_chars: 0,
    per_min: 0,
    per_page: 0,
    per_training: 0,
  };
  for (const p of Object.values(MEDIA_PRICING)) counts[p.unit]++;
  return counts;
}
