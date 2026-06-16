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
//
// Auth header `x-key`. Request→poll: POST returns {id, polling_url, cost}; we poll the
// EU get_result by id (deliberately NOT the returned polling_url) so a response carrying
// a face never transits a non-EU host. BFL returns the real `cost` in credits
// (1 credit = $0.01, official) → usage.costUsd is exact, not estimated.
import { freshUsage } from "../cost/usage.js";
import type { ProviderAdapter, ImageRequest, ImageResult } from "../types.js";

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
}

// flux-pro-1.1-ultra-finetuned per-image USD. BFL bills per generated image; verify
// against bfl.ai/pricing before relying on this (override via config.pricePerImage).
const BFL_IMAGE_PRICE = 0.06;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
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
    if (req.referenceImages?.length) {
      // F023.5 — FLUX 2 multi-reference: input_image, input_image_2 … input_image_8.
      req.referenceImages.forEach((img, i) => {
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
        "bfl adapter: requires referenceImages (FLUX 2 multi-reference) or a finetune id. " +
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
      transport: "http",
      capability: "image",
      inputTokens: 0,
      outputTokens: 0,
    });
    // BFL returns the real billed cost (credits) — use it; fall back to the estimate.
    usage.costUsd =
      typeof submit.cost === "number"
        ? submit.cost * BFL_CREDIT_USD
        : (config.pricePerImage ?? BFL_IMAGE_PRICE);
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
    const headers = { "x-key": apiKey };
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await doFetch(`${base}/v1/get_result?id=${encodeURIComponent(id)}`, { headers });
      if (!res.ok) throw new Error(`bfl get_result ${res.status}`);
      const data = (await res.json()) as BflResultResponse;
      const status = data.status ?? "";
      if (status === "Ready") {
        const sample = data.result?.sample;
        if (!sample) throw new Error("bfl: status Ready but no result.sample url");
        return sample;
      }
      if (status === "Error" || status === "Failed" || status === "Task not found") {
        throw new Error(`bfl: generation ${status}`);
      }
      if (status.includes("Moderated")) {
        throw new Error(`bfl: ${status} — prompt or output flagged by BFL safety`);
      }
      if (Date.now() >= deadline) throw new Error(`bfl: timed out after ${timeoutMs}ms`);
      await sleep(pollIntervalMs);
    }
  }

  return { name: "bfl", image };
}
