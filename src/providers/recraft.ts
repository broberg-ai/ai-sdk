// Recraft adapter (F070) — raster image → SVG (vectorize). One capability.
//
// Recraft's docs (read 2026-10-07): POST /v1/images/vectorize, Bearer RECRAFT_API_TOKEN,
// JSON { image_url } (a URL or a data: URL), optional shape_stacking. The answer is
// { created, credits, image: { image_id, url } } and the url points at an SVG that lives
// ~24 hours. We download it in the same call, so a caller never holds a link that stops
// working tomorrow. Price: $0.01 per call (media-pricing "recraft:vectorize").
import { freshUsage } from "../cost/usage.js";
import { regionOfHost } from "../cost/region.js";
import { getMediaPrice } from "../cost/media-pricing.js";
import { DEFAULT_BASE_URLS } from "../cost/default-hosts.js";
import { toInlineImage } from "./media.js";
import type { ProviderAdapter, VectorizeRequest, VectorizeResult } from "../types.js";

export function recraftAdapter(
  config: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch } = {},
): ProviderAdapter {
  const fetchImpl = config.fetch ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URLS.recraft;

  function key(): string {
    const k = config.apiKey ?? process.env.RECRAFT_API_TOKEN;
    if (!k) throw new Error("recraft adapter: API token not set (env RECRAFT_API_TOKEN)");
    return k;
  }

  async function vectorize(req: VectorizeRequest): Promise<VectorizeResult> {
    const token = key();
    // A plain https URL is passed through — Recraft fetches it. Bytes and data: URLs go
    // inline as a data: URL, so no third storage is involved.
    const imageUrl =
      typeof req.image === "string" && /^https?:\/\//i.test(req.image)
        ? req.image
        : await toInlineImage(req.image, fetchImpl).then(({ data, mimeType }) => `data:${mimeType};base64,${data}`);
    const body: Record<string, unknown> = { image_url: imageUrl };
    if (req.shapeStacking) body.shape_stacking = req.shapeStacking;

    const res = await fetchImpl(`${baseUrl}/images/vectorize`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`recraft vectorize ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const data = (await res.json()) as { credits?: number; image?: { url?: string } };
    const url = data.image?.url;
    if (!url) throw new Error("recraft vectorize: response contained no image url");
    const svgRes = await fetchImpl(url);
    if (!svgRes.ok) throw new Error(`recraft vectorize: could not download the SVG (${svgRes.status})`);
    const svg = await svgRes.text();
    if (!svg.includes("<svg")) throw new Error("recraft vectorize: downloaded file is not an SVG");

    const usage = freshUsage({
      provider: "recraft",
      region: regionOfHost(baseUrl),
      model: req.spec.model,
      transport: "http",
      capability: "vectorize",
      inputTokens: 0,
      outputTokens: 0,
    });
    usage.costUsd = getMediaPrice("recraft", "vectorize")?.usd ?? 0;
    usage.costBasis = "estimated";
    return { svg, usage };
  }

  return { name: "recraft", vectorize };
}
