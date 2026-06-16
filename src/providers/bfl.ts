// Black Forest Labs (FLUX) adapter — F023. EU-RESIDENT finetuned-inference ONLY.
//
// GDPR CRUX (non-negotiable): this adapter hard-pins https://api.eu.bfl.ai — the
// dedicated EU endpoint — NEVER the global api.bfl.ai (which auto-failovers to the
// US and could route a face out of the EEA). A face = biometric personal data, so
// EU residency is what makes this compliant; "German company" alone is not enough.
// The default base is asserted in bfl.test.ts.
//
// SCOPE: finetuned INFERENCE only. BFL retired finetune-CREATE from the public API
// (live-verified 2026-06-16: POST /v1/finetune → 404 on every region with a valid
// key, while inference paths 422; legacy eu1/us1 finetune hosts TCP-dead). Training
// a subject is therefore a MANUAL one-time step in the BFL dashboard — see the SOP in
// docs/features/F023-bfl-eu-portrait-lora.md. Once trained, the finetune_id flows
// here: ai.image({ finetune, override: { provider: "bfl" } }).
//
// Auth header `x-key`. Request→poll: POST returns {id, polling_url}; we poll the EU
// get_result by id (deliberately NOT the returned polling_url) so a response carrying
// a face never transits a non-EU host.
import { freshUsage } from "../cost/usage.js";
import type { ProviderAdapter, ImageRequest, ImageResult } from "../types.js";

const EU_BASE = "https://api.eu.bfl.ai";

interface BflSubmitResponse {
  id?: string;
  polling_url?: string;
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
    if (!req.finetune) {
      throw new Error(
        "bfl adapter: requires a finetune id — call ai.image({ finetune, override: { provider: 'bfl' } }). " +
          "Train the subject once in the BFL dashboard (dashboard.bfl.ai) — finetune-create is not in the public API.",
      );
    }
    const headers = { "content-type": "application/json", "x-key": apiKey };

    const body: Record<string, unknown> = {
      finetune_id: req.finetune,
      prompt: req.prompt,
    };
    if (req.finetuneStrength !== undefined) body.finetune_strength = req.finetuneStrength;
    // flux-pro-1.1-ultra takes aspect_ratio, not width/height — derive it when both given.
    if (req.width && req.height) {
      const g = gcd(req.width, req.height) || 1;
      body.aspect_ratio = `${req.width / g}:${req.height / g}`;
    }

    const submitRes = await doFetch(`${base}/v1/flux-pro-1.1-ultra-finetuned`, {
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
    usage.costUsd = config.pricePerImage ?? BFL_IMAGE_PRICE;
    return { url: sample, usage };
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
