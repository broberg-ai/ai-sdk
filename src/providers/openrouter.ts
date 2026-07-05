// OpenRouter adapter (F4.4). Meta-router with an OpenAI-compatible API — reuses
// the shared core + OpenRouter's attribution headers. Any upstream model is
// reachable by its slug, e.g. "minimax/minimax-m2.7", "google/gemini-2.5-flash".
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import { freshUsage } from "../cost/usage.js";
import type { ProviderAdapter, ImageRequest, ImageResult } from "../types.js";

// F033.1 — OpenRouter's unified Image API (POST /images, distinct from
// /chat/completions) returns base64 image data under data[].b64_json, plus a
// ground-truth usage.cost (USD) like chat does. Vector/SVG output is the same
// shape with data[].media_type = "image/svg+xml". A model/policy error can come
// back as HTTP 200 with an empty data[] and a structured `error` — surfaced so
// the caller sees the real cause, not a generic "no image data".
interface OpenRouterImageResponse {
  data?: { b64_json?: string; media_type?: string }[];
  usage?: { cost?: number };
  error?: { message?: string } | string;
}

// Per-image USD ESTIMATES — fallback for when OpenRouter's response omits
// usage.cost. Verified 2026-07-03 against openrouter.ai/recraft/recraft-v4.1*
// (override via config.pricePerImage).
const OPENROUTER_IMAGE_PRICE_ESTIMATE: Record<string, number> = {
  "recraft/recraft-v4.1": 0.035,
  "recraft/recraft-v4.1-vector": 0.08,
};

export interface OpenRouterAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
  referer?: string;
  title?: string;
  fetch?: typeof fetch;
  /** Override the per-image USD price (else OPENROUTER_IMAGE_PRICE_ESTIMATE, else 0). */
  pricePerImage?: number;
}

export function openrouterAdapter(config: OpenRouterAdapterConfig = {}): ProviderAdapter {
  const baseUrl = config.baseUrl ?? "https://openrouter.ai/api/v1";
  const headers = {
    "HTTP-Referer": config.referer ?? "https://broberg.ai",
    "X-Title": config.title ?? "@broberg/ai-sdk",
  };
  const base = makeOpenAICompatibleAdapter({
    name: "openrouter",
    baseUrl,
    apiKey: config.apiKey,
    extraHeaders: headers,
    // Forward the injectable fetch so an override applies uniformly to
    // chat/chatStream/vision as well as the image() path below.
    fetch: config.fetch,
    // OpenRouter returns ground-truth usage.cost (USD) when usage:{include:true}
    // is set — use it over the local pricing-table estimate (F010).
    costFromResponseField: true,
  });

  async function image(req: ImageRequest): Promise<ImageResult> {
    const apiKey = config.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("openrouter adapter: OPENROUTER_API_KEY not set");
    const doFetch = config.fetch ?? fetch;

    const body: Record<string, unknown> = { model: req.spec.model, prompt: req.prompt };
    if (req.width !== undefined && req.height !== undefined) {
      body.size = `${req.width}x${req.height}`;
    }
    // OpenRouter's Image API takes top-level `seed` (reproducibility) and
    // `output_format` (png/jpeg/webp) — forward the ImageRequest fields the
    // rest of the SDK exposes (matches bfl.ts) instead of silently dropping them.
    if (req.seed !== undefined) body.seed = req.seed;
    if (req.outputFormat !== undefined) body.output_format = req.outputFormat;

    const res = await doFetch(`${baseUrl}/images`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`openrouter images ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    }
    const data = (await res.json()) as OpenRouterImageResponse;
    const first = data.data?.[0];
    if (!first?.b64_json) {
      // A flagged/failed generation can arrive as 200 + empty data + an error
      // payload — surface it so a moderation block reads differently than a glitch.
      const errMsg = typeof data.error === "string" ? data.error : data.error?.message;
      throw new Error(`openrouter images: ${errMsg ?? "no image data in response"}`);
    }

    const usage = freshUsage({
      provider: "openrouter",
      model: req.spec.model,
      transport: "http",
      capability: "image",
      inputTokens: 0,
      outputTokens: 0,
    });
    usage.costUsd =
      data.usage?.cost ?? config.pricePerImage ?? OPENROUTER_IMAGE_PRICE_ESTIMATE[req.spec.model] ?? 0;
    return { url: `data:${first.media_type ?? "image/png"};base64,${first.b64_json}`, usage };
  }

  return { ...base, image };
}
