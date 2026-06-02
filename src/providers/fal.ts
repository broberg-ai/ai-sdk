// fal.ai image adapter (F5.3). Two modes, both observed in the F1 inventory:
//   - sync  : POST https://fal.run/{model}, image URL straight back (sanneandersen)
//   - queue : POST https://queue.fal.run/{model} → poll status → fetch result
// Auth header `Authorization: Key <FAL_KEY>`. No @fal-ai/client — plain fetch.
import { freshUsage } from "../cost/usage.js";
import type { ProviderAdapter, ImageRequest, ImageResult } from "../types.js";

interface FalImagesResponse {
  images?: { url?: string }[];
  error?: unknown;
}
interface FalQueueSubmit {
  request_id?: string;
  status_url?: string;
  response_url?: string;
}
interface FalQueueStatus {
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
}

export interface FalAdapterConfig {
  apiKey?: string;
  /** "sync" (default — fal.run, fast models) or "queue" (queue.fal.run, polled). */
  mode?: "sync" | "queue";
  syncBaseUrl?: string;
  queueBaseUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Override the per-image USD price (else a built-in estimate per model, 0 if unknown). */
  pricePerImage?: number;
}

// Per-image USD ESTIMATES (fal prices by megapixel/model and changes often —
// verify before relying on these; override via config.pricePerImage). fal does
// not return a price, so this is the SDK's best-effort cost for `usage.costUsd`.
const FAL_IMAGE_PRICE_ESTIMATE: Record<string, number> = {
  "fal-ai/flux/schnell": 0.003,
  "fal-ai/flux/dev": 0.025,
  "fal-ai/flux-pro": 0.05,
  "fal-ai/flux-pro/v1.1": 0.04,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function falAdapter(config: FalAdapterConfig = {}): ProviderAdapter {
  const doFetch = config.fetch ?? fetch;
  const syncBase = config.syncBaseUrl ?? "https://fal.run";
  const queueBase = config.queueBaseUrl ?? "https://queue.fal.run";
  const pollIntervalMs = config.pollIntervalMs ?? 2000;
  const timeoutMs = config.timeoutMs ?? 60000;

  async function image(req: ImageRequest): Promise<ImageResult> {
    const apiKey = config.apiKey ?? process.env.FAL_KEY;
    if (!apiKey) throw new Error("fal adapter: FAL_KEY not set");
    const headers = { "content-type": "application/json", Authorization: `Key ${apiKey}` };

    const body: Record<string, unknown> = { prompt: req.prompt };
    if (req.width !== undefined && req.height !== undefined) {
      body.image_size = { width: req.width, height: req.height };
    }

    const mode = config.mode ?? "sync";
    const url = await (mode === "sync"
      ? runSync(req.spec.model, headers, body)
      : runQueue(req.spec.model, headers, body));

    // fal returns no price; estimate per-image (one image per call) so usage.costUsd
    // isn't silently 0. Override via config.pricePerImage.
    const usage = freshUsage({
      provider: "fal",
      model: req.spec.model,
      transport: "http",
      capability: "image",
      inputTokens: 0,
      outputTokens: 0,
    });
    usage.costUsd = config.pricePerImage ?? FAL_IMAGE_PRICE_ESTIMATE[req.spec.model] ?? 0;
    return { url, usage };
  }

  async function runSync(
    model: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<string> {
    const res = await doFetch(`${syncBase}/${model}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`fal ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    const data = (await res.json()) as FalImagesResponse;
    const out = data.images?.[0]?.url;
    if (!out) throw new Error(`fal: no image url in response`);
    return out;
  }

  async function runQueue(
    model: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<string> {
    const submitRes = await doFetch(`${queueBase}/${model}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!submitRes.ok) {
      throw new Error(`fal queue submit ${submitRes.status}`);
    }
    const submit = (await submitRes.json()) as FalQueueSubmit;
    const statusUrl = submit.status_url;
    const responseUrl = submit.response_url;
    if (!statusUrl || !responseUrl) throw new Error("fal queue: missing status/response url");

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const statusRes = await doFetch(statusUrl, { headers });
      const status = (await statusRes.json()) as FalQueueStatus;
      if (status.status === "COMPLETED") break;
      if (status.status === "FAILED") throw new Error("fal queue: generation FAILED");
      if (Date.now() >= deadline) throw new Error(`fal queue: timed out after ${timeoutMs}ms`);
      await sleep(pollIntervalMs);
    }

    const resultRes = await doFetch(responseUrl, { headers });
    const result = (await resultRes.json()) as FalImagesResponse;
    const out = result.images?.[0]?.url;
    if (!out) throw new Error("fal queue: no image url in result");
    return out;
  }

  return { name: "fal", image };
}
