// Black Forest Labs (FLUX) adapter — F023 / F023.5. EU-RESIDENT image generation.
//
// GDPR CRUX (non-negotiable): this adapter hard-pins https://api.eu.bfl.ai — the
// dedicated EU endpoint — NEVER the global api.bfl.ai (which auto-failovers to the
// US and could route a face out of the EEA). A face = biometric personal data, so
// EU residency is what makes this compliant; "German company" alone is not enough.
// The default base is asserted in bfl.test.ts.
//
// Two EU-resident likeness modes (route by what ai.image is given):
//  • referenceImages (F023.5) → FLUX 2 multi-reference: 1–8 photos in the generate
//    call, NO training step. Default model flux-2-max ($0.25/img); pass
//    override:{ model:"flux-2-pro" } for ~half price ($0.12/img). Bytes are
//    base64-inlined into the EU call (no cross-region fetch); URLs pass through.
//  • finetune (F023) → flux-pro-1.1-ultra-finetuned, a subject trained ONCE in the
//    BFL dashboard (finetune-CREATE was retired from the public API — live-verified
//    2026-06-16: POST /v1/finetune 404s on every region; legacy eu1/us1 hosts dead).
//    See the dashboard SOP in docs/features/F023-bfl-eu-portrait-lora.md.
//  • neither, on a flux-2* model (F064) → plain text-to-image, same FLUX 2 body with
//    no input_image*. The EU route for an ordinary prompt:
//    ai.image({ prompt, override:{ provider:"bfl", model:"flux-2-pro" } }).
//
// Auth header `x-key`. Request→poll: POST returns {id, polling_url, cost}; we poll the
// EU get_result by id (deliberately NOT the returned polling_url) so a response carrying
// a face never transits a non-EU host. BFL returns the real `cost` in credits
// (1 credit = $0.01, official) → usage.costUsd is exact, not estimated.
import { freshUsage } from "../cost/usage.js";
import { getMediaPrice } from "../cost/media-pricing.js";
import type { Region } from "../cost/region.js";
import type { ProviderAdapter, ImageRequest, ImageResult, AnimateRequest, AnimateResult } from "../types.js";

const EU_BASE = "https://api.eu.bfl.ai";
/** BFL bills in credits; 1 credit = $0.01 USD (official, bfl.ai/pricing). */
const BFL_CREDIT_USD = 0.01;

interface BflSubmitResponse {
  id?: string;
  polling_url?: string;
  /** BFL's billed cost for this request, in credits. */
  cost?: number;
}
interface BflResultResponse {
  id?: string;
  /** "Ready" | "Pending" | "Error" | "Request Moderated" | "Content Moderated" | "Task not found" */
  status?: string;
  result?: { sample?: string } | null;
  progress?: number | null;
  /** F079 — settled cost in credits. Video reports it HERE (submit's `cost` is null). */
  cost?: number | null;
}

export interface BflAdapterConfig {
  apiKey?: string;
  /** EU-resident base. Do NOT point this at api.bfl.ai (global, US-failover) — see header. */
  baseUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Override the per-image USD price (else the built-in finetuned-inference estimate). */
  pricePerImage?: number;
  /** F079 — video generation is slower; measured 20/10 2026: a 5 s hd clip took ~50 s. */
  videoTimeoutMs?: number;
}

/** F079 — ai.animate's resolution words → FLUX 3 Video's resolution classes. */
const FLUX3_RESOLUTION: Record<string, string> = {
  hd: "hd", "720p": "hd",
  fhd: "fhd", "1080p": "fhd",
  qhd: "qhd", "1440p": "qhd",
  uhd: "uhd", "2160p": "uhd", "4k": "uhd",
};

/** F079 — a BFL result URL must stay on an EU host. Measured 20/10 2026: polling and
 *  delivery come back on api.eu2.bfl.ai / delivery.eu2.bfl.ai, so "eu" plus an
 *  optional digit, never the global api.bfl.ai / delivery.bfl.ai. */
export function isBflEuHost(url: string): boolean {
  try {
    return /(^|\.)eu\d*\.bfl\.ai$/.test(new URL(url).host.toLowerCase());
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Remaining BFL account credits + their USD value (1 credit = $0.01). */
export interface BflCredits {
  credits: number;
  usd: number;
}

/** F023.6 — check the BFL account's remaining credit balance (`GET /v1/credits`).
 *  Account-level (region-independent); EU-pinned by default for consistency. Use it
 *  for budget-gating before a generate call: `if ((await bflCredits()).usd < 1) …`. */
export async function bflCredits(
  opts: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch } = {},
): Promise<BflCredits> {
  const apiKey = opts.apiKey ?? process.env.BFL_API_KEY;
  if (!apiKey) throw new Error("bflCredits: BFL_API_KEY not set");
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(`${opts.baseUrl ?? EU_BASE}/v1/credits`, { headers: { "x-key": apiKey } });
  if (!res.ok) {
    throw new Error(`bflCredits ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  const data = (await res.json()) as { credits?: number };
  const credits = typeof data.credits === "number" ? data.credits : 0;
  return { credits, usd: credits * BFL_CREDIT_USD };
}

/** Residency of a BFL base URL (F042). Only the dedicated EU host is an EU claim;
 *  the global api.bfl.ai auto-failovers to the US, so where a call landed is not
 *  something we can observe from here — "unknown" is the truthful answer, and it is
 *  deliberately not "us" (a failover MAY have stayed in the EU; we just cannot say). */
function bflRegion(base: string): Region {
  try {
    return new URL(base).host.toLowerCase() === "api.eu.bfl.ai" ? "eu" : "unknown";
  } catch {
    return "unknown";
  }
}

export function bflAdapter(config: BflAdapterConfig = {}): ProviderAdapter {
  const doFetch = config.fetch ?? fetch;
  const base = config.baseUrl ?? EU_BASE;
  const pollIntervalMs = config.pollIntervalMs ?? 1500;
  const timeoutMs = config.timeoutMs ?? 120000;

  const resolveKey = () => config.apiKey ?? process.env.BFL_API_KEY;

  async function image(req: ImageRequest): Promise<ImageResult> {
    const apiKey = resolveKey();
    if (!apiKey) throw new Error("bfl adapter: BFL_API_KEY not set");
    const headers = { "content-type": "application/json", "x-key": apiKey };

    const body: Record<string, unknown> = { prompt: req.prompt };
    // F064 — FLUX 2 generates from the prompt alone; references are optional. That is
    // the EU route for a plain text-to-image call.
    const flux2PromptOnly = !req.referenceImages?.length && !req.finetune && req.spec.model.startsWith("flux-2");
    if (req.referenceImages?.length || flux2PromptOnly) {
      // F023.5 — FLUX 2 multi-reference: input_image, input_image_2 … input_image_8.
      req.referenceImages?.forEach((img, i) => {
        body[i === 0 ? "input_image" : `input_image_${i + 1}`] = toBflImage(img);
      });
      if (req.width) body.width = req.width;
      if (req.height) body.height = req.height;
      if (req.seed !== undefined) body.seed = req.seed;
      body.output_format = req.outputFormat ?? "jpeg";
      body.safety_tolerance = req.safetyTolerance ?? 2;
    } else if (req.finetune) {
      // F023 — finetuned subject (trained once in the BFL dashboard).
      body.finetune_id = req.finetune;
      if (req.finetuneStrength !== undefined) body.finetune_strength = req.finetuneStrength;
      // flux-pro-1.1-ultra takes aspect_ratio, not width/height — derive it when both given.
      if (req.width && req.height) {
        const g = gcd(req.width, req.height) || 1;
        body.aspect_ratio = `${req.width / g}:${req.height / g}`;
      }
    } else {
      throw new Error(
        `bfl adapter: ${req.spec.model} requires referenceImages (FLUX 2 multi-reference) or a finetune id. ` +
          "For a plain prompt use a FLUX 2 model: override:{ provider:\"bfl\", model:\"flux-2-pro\" }. " +
          "ai.image({ referenceImages: [...] }) needs no training; ai.image({ finetune }) uses a subject " +
          "trained once in the BFL dashboard (dashboard.bfl.ai — finetune-create is not in the public API).",
      );
    }

    const submitRes = await doFetch(`${base}/v1/${req.spec.model}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!submitRes.ok) {
      throw new Error(`bfl ${submitRes.status}: ${(await submitRes.text().catch(() => "")).slice(0, 200)}`);
    }
    const submit = (await submitRes.json()) as BflSubmitResponse;
    if (!submit.id) throw new Error("bfl: no task id in submit response");

    const sample = await poll(submit.id, apiKey);

    const usage = freshUsage({
      provider: "bfl",
      model: req.spec.model,
      region: bflRegion(base),
      transport: "http",
      capability: "image",
      inputTokens: 0,
      outputTokens: 0,
    });
    // BFL REPORTS the real billed cost in credits — that is the good case, and it is
    // the one case in the SDK where the provider answers the cost question itself.
    // Only the fallback is a guess, and it says so rather than looking identical.
    if (typeof submit.cost === "number") {
      usage.costUsd = submit.cost * BFL_CREDIT_USD;
      usage.costBasis = "reported";
    } else {
      usage.costUsd =
        config.pricePerImage ?? getMediaPrice("bfl", "flux-pro-1.1-ultra-finetuned")?.usd ?? 0;
      usage.costBasis = config.pricePerImage !== undefined ? "computed" : "estimated";
    }
    return { url: sample, usage };
  }

  /** A URL passes through; raw bytes / a data: URI become a plain base64 string
   *  (BFL's input_image wants base64, not a data: URI — verified live). */
  function toBflImage(img: string | Uint8Array): string {
    if (typeof img !== "string") return Buffer.from(img).toString("base64");
    if (/^https?:\/\//i.test(img)) return img;
    const comma = img.startsWith("data:") ? img.indexOf(",") : -1;
    return comma >= 0 ? img.slice(comma + 1) : img;
  }

  /** Poll the EU get_result by id until Ready (or a terminal/moderated status). */
  async function poll(id: string, apiKey: string): Promise<string> {
    return (await pollResult(id, apiKey, timeoutMs)).sample;
  }

  /** Like poll, but also returns the settled credit cost (F079: video reports it here).
   *  Any status that is not terminal — "Pending", "Reasoning", "Generating" (all three
   *  measured on one video, 20/10 2026) — keeps polling. */
  async function pollResult(id: string, apiKey: string, limitMs: number): Promise<{ sample: string; cost?: number }> {
    const headers = { "x-key": apiKey };
    const deadline = Date.now() + limitMs;
    for (;;) {
      const res = await doFetch(`${base}/v1/get_result?id=${encodeURIComponent(id)}`, { headers });
      if (!res.ok) throw new Error(`bfl get_result ${res.status}`);
      const data = (await res.json()) as BflResultResponse;
      const status = data.status ?? "";
      if (status === "Ready") {
        const sample = data.result?.sample;
        if (!sample) throw new Error("bfl: status Ready but no result.sample url");
        return { sample, ...(typeof data.cost === "number" ? { cost: data.cost } : {}) };
      }
      if (status === "Error" || status === "Failed" || status === "Task not found") {
        throw new Error(`bfl: generation ${status}`);
      }
      if (status.includes("Moderated")) {
        throw new Error(`bfl: ${status} — prompt or output flagged by BFL safety`);
      }
      if (Date.now() >= deadline) throw new Error(`bfl: timed out after ${limitMs}ms`);
      await sleep(pollIntervalMs);
    }
  }


  /** F079 — FLUX 3 Video on the EU endpoint. With an image: image→video (`i2v`, the
   *  image is the first keyframe). Without: text→video (`t2v`). */
  async function animate(req: AnimateRequest): Promise<AnimateResult> {
    const apiKey = resolveKey();
    if (!apiKey) throw new Error("bfl adapter: BFL_API_KEY not set");
    const prompt = req.prompt?.trim();
    if (!prompt) throw new Error("bfl animate: FLUX 3 Video requires a prompt (BFL rejects a video request without one)");

    const body: Record<string, unknown> = { prompt, mode: req.image ? "i2v" : "t2v" };
    if (req.image) body.keyframes = [toBflImage(req.image)];
    if (req.durationSec !== undefined) {
      const d = Math.round(req.durationSec);
      if (d < 5 || d > 20) throw new Error(`bfl animate: durationSec must be 5–20 for FLUX 3 Video (got ${req.durationSec})`);
      body.duration = d;
    }
    if (req.resolution !== undefined) {
      const r = FLUX3_RESOLUTION[req.resolution.toLowerCase()];
      if (!r) {
        throw new Error(
          `bfl animate: unknown resolution "${req.resolution}" — use one of ${Object.keys(FLUX3_RESOLUTION).join(", ")}`,
        );
      }
      body.resolution = r;
    }
    // generate_audio is left at BFL's default (true): the SDK's animate contract is
    // "ambient sound, no speech", carried by the prompt directive client.ts appends.

    const submitRes = await doFetch(`${base}/v1/${req.spec.model}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-key": apiKey },
      body: JSON.stringify(body),
    });
    if (!submitRes.ok) {
      throw new Error(`bfl ${submitRes.status}: ${(await submitRes.text().catch(() => "")).slice(0, 200)}`);
    }
    const submit = (await submitRes.json()) as BflSubmitResponse;
    if (!submit.id) throw new Error("bfl: no task id in submit response");

    const { sample, cost } = await pollResult(submit.id, apiKey, config.videoTimeoutMs ?? 600000);
    if (!isBflEuHost(sample)) {
      throw new Error(`bfl animate: result URL is not on an EU host (${new URL(sample).host}) — refusing to fetch it`);
    }
    const videoRes = await doFetch(sample);
    if (!videoRes.ok) throw new Error(`bfl animate: download ${videoRes.status}`);
    const bytes = new Uint8Array(await videoRes.arrayBuffer());

    const usage = freshUsage({
      provider: "bfl",
      model: req.spec.model,
      region: bflRegion(base),
      transport: "http",
      capability: "animate",
      inputTokens: 0,
      outputTokens: 0,
    });
    const credits = cost ?? (typeof submit.cost === "number" ? submit.cost : undefined);
    if (credits !== undefined) {
      usage.costUsd = credits * BFL_CREDIT_USD;
      usage.costBasis = "reported";
    } else {
      // Fallback only: the hd per-second rate measured 20/10 2026, times the clip length
      // we asked for (or BFL's 5 s minimum when we left it to "auto").
      usage.costUsd = (getMediaPrice("bfl", req.spec.model)?.usd ?? 0) * (body.duration as number | undefined ?? 5);
      usage.costBasis = "estimated";
    }
    return { url: sample, bytes, mimeType: videoRes.headers.get("content-type") ?? "video/mp4", usage };
  }

  return { name: "bfl", image, animate };
}
