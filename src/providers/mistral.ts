// Mistral adapter. Mistral's La Plateforme exposes an OpenAI-compatible chat
// endpoint (the shared core), plus two specialty endpoints we add here:
// /ocr (F016.2, per-page) and /moderations (F016.4, per-token). Key resolved
// from MISTRAL_API_KEY when not passed.
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import { freshUsage } from "../cost/usage.js";
import type {
  ProviderAdapter,
  OcrRequest,
  OcrResult,
  OcrPage,
  ModerationRequest,
  ModerationResult,
  ModerationItem,
  EmbeddingRequest,
  EmbeddingResult,
  TranscribeRequest,
  TranscribeResult,
} from "../types.js";

/** Per-page USD for Mistral OCR ($2 / 1000 pages). Overridable via config. */
const MISTRAL_OCR_PRICE_PER_PAGE = 0.002;

/** Per-minute USD for Voxtral transcription models (F016.3). */
const VOXTRAL_PRICE_PER_MIN: Record<string, number> = {
  "voxtral-mini-latest": 0.002,
  "voxtral-mini-2507": 0.002,
  "voxtral-mini-2602": 0.002,
};

export function mistralAdapter(
  config: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch; pricePerPage?: number } = {},
): ProviderAdapter {
  const baseUrl = config.baseUrl ?? "https://api.mistral.ai/v1";
  const base = makeOpenAICompatibleAdapter({ name: "mistral", baseUrl, apiKey: config.apiKey });

  function key(): string {
    const k = config.apiKey ?? process.env.MISTRAL_API_KEY;
    if (!k) throw new Error("mistral adapter: API key not set (env MISTRAL_API_KEY)");
    return k;
  }
  const fetchImpl = config.fetch ?? fetch;

  // OCR (F016.2) — POST /ocr. document is a URL/data-URL; image/* routes as an
  // image, anything else as a document (PDF etc.). Billed per page processed.
  async function ocr(req: OcrRequest): Promise<OcrResult> {
    const isImage = (req.mimeType ?? "").startsWith("image/");
    const url =
      typeof req.document === "string"
        ? req.document
        : `data:${req.mimeType ?? "application/pdf"};base64,${Buffer.from(req.document).toString("base64")}`;
    const document = isImage
      ? { type: "image_url", image_url: url }
      : { type: "document_url", document_url: url };

    const res = await fetchImpl(`${baseUrl}/ocr`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key()}` },
      body: JSON.stringify({ model: req.spec.model, document }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`mistral ocr ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      pages?: { index?: number; markdown?: string }[];
      usage_info?: { pages_processed?: number };
    };
    const pages: OcrPage[] = (data.pages ?? []).map((p, i) => ({
      index: p.index ?? i,
      markdown: p.markdown ?? "",
    }));
    const pagesProcessed = data.usage_info?.pages_processed ?? pages.length;
    const usage = freshUsage({
      provider: "mistral",
      model: req.spec.model,
      transport: "http",
      capability: "ocr",
      inputTokens: 0,
      outputTokens: 0,
    });
    usage.costUsd = pagesProcessed * (config.pricePerPage ?? MISTRAL_OCR_PRICE_PER_PAGE);
    return { pages, usage };
  }

  // Moderation (F016.4) — POST /moderations. Returns per-input category booleans
  // + scores; `flagged` = any category true. Billed per input token (estimated
  // from input length when the API omits a usage count).
  async function moderate(req: ModerationRequest): Promise<ModerationResult> {
    const res = await fetchImpl(`${baseUrl}/moderations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key()}` },
      body: JSON.stringify({ model: req.spec.model, input: req.input }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`mistral moderation ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      results?: { categories?: Record<string, boolean>; category_scores?: Record<string, number> }[];
      usage?: { prompt_tokens?: number };
    };
    const results: ModerationItem[] = (data.results ?? []).map((r) => {
      const categories = r.categories ?? {};
      return {
        flagged: Object.values(categories).some(Boolean),
        categories,
        categoryScores: r.category_scores ?? {},
      };
    });
    // The moderation endpoint usually omits token counts → estimate from input.
    const estIn = req.input.reduce((n, s) => n + Math.ceil(s.length / 4), 0);
    const usage = freshUsage({
      provider: "mistral",
      model: req.spec.model,
      transport: "http",
      capability: "moderation",
      inputTokens: data.usage?.prompt_tokens ?? estIn,
      outputTokens: 0,
    });
    return { results, usage };
  }

  // Embeddings (F016.5) — POST /embeddings (OpenAI-compatible). Per-token input.
  async function embedding(req: EmbeddingRequest): Promise<EmbeddingResult> {
    const res = await fetchImpl(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key()}` },
      body: JSON.stringify({ model: req.spec.model, input: req.input }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`mistral embeddings ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      data?: { embedding: number[] }[];
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };
    const vectors = (data.data ?? []).map((d) => d.embedding);
    const usage = freshUsage({
      provider: "mistral",
      model: req.spec.model,
      transport: "http",
      capability: "embedding",
      inputTokens: data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0,
      outputTokens: 0,
    });
    return { vectors, usage };
  }

  // Transcribe (F016.3) — Voxtral via OpenAI-compatible /audio/transcriptions
  // (multipart). Per-minute cost when durationSec is supplied.
  async function transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    const form = new FormData();
    form.append("file", new Blob([req.audio]), "audio");
    form.append("model", req.spec.model);
    if (req.language) form.append("language", req.language);
    const res = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key()}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`mistral transcribe ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { text?: string };
    const usage = freshUsage({
      provider: "mistral",
      model: req.spec.model,
      transport: "http",
      capability: "transcribe",
      inputTokens: 0,
      outputTokens: 0,
    });
    if (req.durationSec !== undefined) {
      usage.costUsd = (req.durationSec / 60) * (VOXTRAL_PRICE_PER_MIN[req.spec.model] ?? 0);
    }
    return { text: data.text ?? "", usage };
  }

  return { ...base, ocr, moderate, embedding, transcribe };
}
