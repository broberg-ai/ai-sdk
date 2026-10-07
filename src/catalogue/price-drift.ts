// F072.1 — Model Watch phase 2: the nightly price check, as a function.
//
// upmetrics' worker calls this every night — a script, no LLM, no agent session
// (D-13a919) — filters to the models the fleet actually called, and raises the alarm.
// The price LOGIC stays here, next to the table it compares against; usage and alarms
// stay at upmetrics. Before this, a price change was caught on the 1st of the month at
// the earliest (/model-research).
//
// Coverage, said out loud: only prices that come with an API — OpenRouter's public
// catalogue. Direct providers (OpenAI, Anthropic, Gemini, Mistral) publish no price API,
// and speech/image/video/OCR prices are hand-checked (F050). `coverage` names that gap
// on every result so "no drift" is never read as "nothing could have changed".
import { fetchOpenRouterCatalogue } from "./fetchers.js";
import { diffCatalogue } from "./diff.js";

export interface PriceDriftRow {
  /** `${provider}:${model}` — the key in ai-sdk's price table. */
  key: string;
  provider: string;
  model: string;
  ours: { inputPer1M: number; outputPer1M: number };
  upstream: { inputPer1M?: number; outputPer1M?: number };
  /** Relative change, upstream vs ours, in percent (+20 = 20 % dearer). Undefined when
   *  upstream omits that side. */
  inputChangePct?: number;
  outputChangePct?: number;
}

export type PriceDriftResult =
  | { ok: true; measuredAt: string; source: "openrouter"; checked: number; drift: PriceDriftRow[]; coverage: string }
  | { ok: false; measuredAt: string; error: string };

const COVERAGE =
  "OpenRouter catalogue only. Not covered: direct-provider prices (no price API) and speech/image/video/OCR (hand-checked, F050).";

function pct(ours: number, up: number | undefined): number | undefined {
  if (up === undefined) return undefined;
  if (ours === 0) return up === 0 ? 0 : Infinity;
  return Math.round(((up - ours) / ours) * 1000) / 10;
}

/** Compare ai-sdk's price table with OpenRouter's live prices. Never throws: an outage
 *  returns `{ ok: false, error }`, so it cannot look like "no price changes". */
export async function checkPriceDrift(opts: { fetch?: typeof fetch; threshold?: number } = {}): Promise<PriceDriftResult> {
  const measuredAt = new Date().toISOString();
  try {
    const models = await fetchOpenRouterCatalogue({ fetch: opts.fetch });
    if (models.length === 0) return { ok: false, measuredAt, error: "OpenRouter returned an empty catalogue" };
    const diff = diffCatalogue(models, { fetchedProviders: ["openrouter"], priceThreshold: opts.threshold ?? 0.01 });
    const drift: PriceDriftRow[] = diff.priceChanged.map((p) => {
      const i = p.key.indexOf(":");
      return {
        key: p.key,
        provider: p.key.slice(0, i),
        model: p.key.slice(i + 1),
        ours: { inputPer1M: p.ourInputPer1M, outputPer1M: p.ourOutputPer1M },
        upstream: { inputPer1M: p.upstreamInputPer1M, outputPer1M: p.upstreamOutputPer1M },
        inputChangePct: pct(p.ourInputPer1M, p.upstreamInputPer1M),
        outputChangePct: pct(p.ourOutputPer1M, p.upstreamOutputPer1M),
      };
    });
    const checked = models.filter((m) => m.inputPer1M !== undefined || m.outputPer1M !== undefined).length;
    return { ok: true, measuredAt, source: "openrouter", checked, drift, coverage: COVERAGE };
  } catch (e) {
    return { ok: false, measuredAt, error: e instanceof Error ? e.message : String(e) };
  }
}
