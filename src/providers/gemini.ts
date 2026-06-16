// Google Gemini adapter (F4.2). generateContent REST API; API key in the query
// param (?key=), not a header. System turns map to systemInstruction; assistant
// maps to role "model". Token counts come from usageMetadata. Tools normalized
// via F4.5. No @google/generative-ai package — plain fetch through httpTransport.
import { httpTransport } from "../transport/http.js";
import { streamTransport } from "../transport/stream.js";
import { toProviderTools, fromProviderToolCall } from "./tools.js";
import { freshUsage } from "../cost/usage.js";
import type {
  ProviderAdapter,
  ChatRequest,
  ChatResult,
  ChatStreamEvent,
  ImageRequest,
  ImageResult,
  AnimateRequest,
  AnimateResult,
  Message,
  ContentPart,
  ToolCall,
} from "../types.js";

/** Per-image USD price for Gemini image-gen models (generateContent image output
 *  is billed per image). Official ai.google.dev/gemini-api/docs/pricing, standard
 *  paid tier, at the 1K/1024px output size (Google's per-image price rises with
 *  resolution — 2K/4K cost more; we record the common 1K default). Overridable
 *  per call via geminiAdapter config.pricePerImage. */
const GEMINI_IMAGE_PRICE_PER_IMAGE: Record<string, number> = {
  "gemini-2.5-flash-image": 0.039, // "nano-banana" — 1024px = 1290 tok
  "gemini-3.1-flash-image": 0.067, // 1K=$0.067, 2K=$0.101, 4K=$0.151
  "gemini-3.1-flash-image-preview": 0.067,
  "gemini-3-pro-image": 0.134, // premium — 1K/2K=$0.134, 4K=$0.24
  "gemini-3-pro-image-preview": 0.134, // was $0.039 — wrong (that's the flash price); pro is $0.134
};

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  inlineData?: { mimeType: string; data: string };
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: unknown;
}

function partsFrom(content: string | ContentPart[]): GeminiPart[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((p): GeminiPart => {
    if (p.type === "text") return { text: p.text };
    // Video (F019) and image both go inline as base64 — Gemini accepts video mime
    // types natively. (Clips over ~20MB need the Files API — not handled here.)
    if (p.type === "video") {
      const data =
        typeof p.video === "string"
          ? p.video.replace(/^data:[^;]+;base64,/, "")
          : Buffer.from(p.video).toString("base64");
      return { inlineData: { mimeType: p.mimeType ?? "video/mp4", data } };
    }
    const data =
      typeof p.image === "string"
        ? p.image.replace(/^data:[^;]+;base64,/, "")
        : Buffer.from(p.image).toString("base64");
    return { inlineData: { mimeType: p.mimeType ?? "image/png", data } };
  });
}

/** Per-SECOND USD for Veo video models (F024). Official ai.google.dev/gemini-api/
 *  docs/pricing (2026-06, "video with audio", 720p/1080p default; 4K costs more).
 *  Override per call via config.pricePerSecond. Unknown model → 0 (never fabricated). */
const VEO_PRICE_PER_SEC: Record<string, number> = {
  "veo-3.1-generate-preview": 0.4, // standard; 4K = 0.60
  "veo-3.1-fast-generate-preview": 0.1, // 720p; 1080p = 0.12, 4K = 0.30
  "veo-3.1-lite-generate-preview": 0.05, // 720p; 1080p = 0.08
  "veo-3.0-generate-001": 0.4,
  "veo-3.0-fast-generate-001": 0.1,
};

export function geminiAdapter(
  config: {
    apiKey?: string;
    baseUrl?: string;
    fetch?: typeof fetch;
    pricePerImage?: number;
    /** Override the per-SECOND Veo video price (else estimate per model, 0 if unknown). */
    pricePerSecond?: number;
    /** Poll interval for Veo long-running operations (default 5s). */
    pollIntervalMs?: number;
    /** Deadline for a Veo job (default 300000 = 5 min). */
    videoTimeoutMs?: number;
  } = {},
): ProviderAdapter {
  const baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";

  function resolveKey(): string {
    const apiKey = config.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("gemini adapter: API key not set (env GOOGLE_API_KEY)");
    return apiKey;
  }

  /** Build the generateContent body (shared by the http + stream paths). */
  function buildBody(req: ChatRequest): Record<string, unknown> {
    const systemParts: GeminiPart[] = [];
    const contents: { role: string; parts: GeminiPart[] }[] = [];
    for (const m of req.messages as Message[]) {
      if (m.role === "system") {
        systemParts.push(...partsFrom(m.content));
      } else {
        contents.push({
          role: m.role === "assistant" ? "model" : "user",
          parts: partsFrom(m.content),
        });
      }
    }
    const body: Record<string, unknown> = { contents };
    if (systemParts.length > 0) body.systemInstruction = { parts: systemParts };
    if (req.tools) body.tools = toProviderTools(req.tools, "gemini");
    const genConfig: Record<string, unknown> = {};
    if (req.maxTokens !== undefined) genConfig.maxOutputTokens = req.maxTokens;
    if (req.temperature !== undefined) genConfig.temperature = req.temperature;
    if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig;
    return body;
  }

  async function chat(req: ChatRequest): Promise<ChatResult> {
    const apiKey = resolveKey();
    const body = buildBody(req);

    const res = await httpTransport({
      spec: req.spec,
      http: {
        url: `${baseUrl}/models/${req.spec.model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        headers: { "content-type": "application/json" },
        body,
      },
    });
    if (!res.ok) {
      throw new Error(`gemini ${res.status}: ${JSON.stringify(res.json).slice(0, 300)}`);
    }
    const data = res.json as GeminiResponse;
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => typeof p.text === "string")
      .map((p) => p.text)
      .join("");
    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall)
      .map((p) => fromProviderToolCall({ functionCall: p.functionCall }, "gemini"));

    const usage = freshUsage({
      provider: "gemini",
      model: req.spec.model,
      transport: "http",
      capability: "chat",
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    });
    const result: ChatResult = { text, usage };
    if (toolCalls.length > 0) result.toolCalls = toolCalls;
    return result;
  }

  // Streaming chat (F8.6) over streamGenerateContent?alt=sse. Each SSE chunk is
  // a partial GenerateContentResponse: parts[].text → text events, parts[].
  // functionCall → complete tool_call events (gemini sends each call whole), and
  // the final usageMetadata → a usage event. finishReason maps the terminal.
  async function* chatStream(req: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const apiKey = resolveKey();
    const body = buildBody(req);
    const stream = streamTransport({
      spec: req.spec,
      fetch: config.fetch,
      http: {
        url: `${baseUrl}/models/${req.spec.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
        headers: { "content-type": "application/json" },
        body,
      },
    });

    const toolCalls: ToolCall[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: string | null = null;

    for await (const data of stream) {
      let chunk: GeminiResponse & { candidates?: { finishReason?: string }[] };
      try {
        chunk = JSON.parse(data) as typeof chunk;
      } catch {
        continue;
      }
      const candidate = chunk.candidates?.[0];
      for (const p of candidate?.content?.parts ?? []) {
        if (typeof p.text === "string" && p.text.length > 0) {
          yield { type: "text", delta: p.text };
        } else if (p.functionCall) {
          toolCalls.push(fromProviderToolCall({ functionCall: p.functionCall }, "gemini"));
        }
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      if (chunk.usageMetadata) {
        inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
      }
    }

    for (const tc of toolCalls) {
      yield { type: "tool_call", id: tc.id, name: tc.name, args: tc.arguments };
    }
    const usage = freshUsage({
      provider: "gemini",
      model: req.spec.model,
      transport: "http",
      capability: "chat",
      inputTokens,
      outputTokens,
    });
    yield { type: "usage", costUsd: usage.costUsd, model: usage.model, usage };
    yield {
      type: "finish",
      reason: toolCalls.length > 0 ? "tool_calls" : mapGeminiFinish(finishReason),
    };
  }

  // Image generation (F013) via generateContent with IMAGE response modality.
  // Gemini returns the image inline as base64 (not a hosted URL like fal), so we
  // hand it back as a data: URL. Built to match cms's nano-banana request.
  async function image(req: ImageRequest): Promise<ImageResult> {
    const apiKey = resolveKey();
    // Direct fetch (injectable for tests) — generateContent is JSON in/out but
    // we read inline image bytes, so we don't route through httpTransport here.
    const fetchImpl = config.fetch ?? fetch;
    const res = await fetchImpl(`${baseUrl}/models/${req.spec.model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        // The multimodal image model can return text + image; ask for both.
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`gemini image ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as GeminiResponse & {
      candidates?: { content?: { parts?: GeminiImagePart[] } }[];
      promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) {
      throw new Error(`gemini image blocked: ${data.promptFeedback.blockReason}`);
    }
    let url: string | undefined;
    for (const p of data.candidates?.[0]?.content?.parts ?? []) {
      // Some responses use camelCase inlineData, others snake_case inline_data.
      const inline = p.inlineData ?? p.inline_data;
      const mime = inline?.mimeType ?? inline?.mime_type;
      const b64 = inline?.data;
      if (mime && b64) {
        url = `data:${mime};base64,${b64}`;
        break;
      }
    }
    if (!url) throw new Error("gemini image: response contained no inline image data");
    const usage = freshUsage({
      provider: "gemini",
      model: req.spec.model,
      transport: "http",
      capability: "image",
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    });
    usage.costUsd = config.pricePerImage ?? GEMINI_IMAGE_PRICE_PER_IMAGE[req.spec.model] ?? 0;
    return { url, usage };
  }

  // Image-to-video (F024) via Veo on the Gemini API — :predictLongRunning. Submit
  // returns an operation; poll until done; the result is an auth-gated file URI, so
  // we download the bytes with the key and hand them back (the URI alone needs auth).
  async function animate(req: AnimateRequest): Promise<AnimateResult> {
    const apiKey = resolveKey();
    const fetchImpl = config.fetch ?? fetch;
    const pollIntervalMs = config.pollIntervalMs ?? 5000;
    const deadline = Date.now() + (config.videoTimeoutMs ?? 300000);

    // Input image → inline base64 + mime (URL is fetched to bytes first).
    const { data, mimeType } = await toInlineImage(req.image, fetchImpl);
    const parameters: Record<string, unknown> = {};
    // durationSeconds must be a NUMBER (the API rejects a string, despite some docs).
    if (req.durationSec !== undefined) parameters.durationSeconds = req.durationSec;
    if (req.resolution !== undefined) parameters.resolution = req.resolution;
    // Veo's predict image field is bytesBase64Encoded + mimeType (NOT generateContent's
    // inlineData — the API rejects that: "inlineData isn't supported by this model").
    const body = {
      instances: [{ prompt: req.prompt ?? "", image: { bytesBase64Encoded: data, mimeType } }],
      ...(Object.keys(parameters).length ? { parameters } : {}),
    };

    const submit = await fetchImpl(
      `${baseUrl}/models/${req.spec.model}:predictLongRunning?key=${encodeURIComponent(apiKey)}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    );
    if (!submit.ok) {
      throw new Error(`gemini animate ${submit.status}: ${(await submit.text().catch(() => "")).slice(0, 300)}`);
    }
    const op = (await submit.json()) as { name?: string };
    if (!op.name) throw new Error("gemini animate: no operation name in submit response");

    // Poll the operation until done.
    let videoUri: string | undefined;
    for (;;) {
      const poll = await fetchImpl(`${baseUrl}/${op.name}?key=${encodeURIComponent(apiKey)}`, {
        headers: { "content-type": "application/json" },
      });
      if (!poll.ok) throw new Error(`gemini animate poll ${poll.status}`);
      const opData = (await poll.json()) as VeoOperation;
      if (opData.error) throw new Error(`gemini animate: ${opData.error.message ?? "operation error"}`);
      if (opData.done) {
        videoUri = opData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!videoUri) throw new Error(`gemini animate: done but no video uri: ${JSON.stringify(opData.response).slice(0, 300)}`);
        break;
      }
      if (Date.now() >= deadline) throw new Error("gemini animate: timed out");
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    // Download the bytes (the URI is auth-gated + short-lived).
    const dl = await fetchImpl(videoUri.includes("key=") ? videoUri : `${videoUri}${videoUri.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`);
    if (!dl.ok) throw new Error(`gemini animate download ${dl.status}`);
    const bytes = new Uint8Array(await dl.arrayBuffer());

    const usage = freshUsage({
      provider: "gemini",
      model: req.spec.model,
      transport: "http",
      capability: "animate",
      inputTokens: 0,
      outputTokens: 0,
    });
    const perSec = config.pricePerSecond ?? VEO_PRICE_PER_SEC[req.spec.model] ?? 0;
    usage.costUsd = perSec * (req.durationSec ?? 8);
    return { url: videoUri, bytes, mimeType: "video/mp4", usage };
  }

  return { name: "gemini", chat, chatStream, image, animate, vision: chat };
}

/** A Veo predictLongRunning operation result shape. */
interface VeoOperation {
  done?: boolean;
  error?: { message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: { video?: { uri?: string } }[];
    };
  };
}

/** Resolve an image input to { data(base64), mimeType } — a URL is fetched to bytes. */
async function toInlineImage(
  image: string | Uint8Array,
  fetchImpl: typeof fetch,
): Promise<{ data: string; mimeType: string }> {
  if (typeof image !== "string") {
    return { data: Buffer.from(image).toString("base64"), mimeType: sniffMime(image) };
  }
  if (/^https?:\/\//i.test(image)) {
    const res = await fetchImpl(image);
    if (!res.ok) throw new Error(`gemini animate: failed to fetch image (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") ?? sniffMime(bytes);
    return { data: Buffer.from(bytes).toString("base64"), mimeType };
  }
  // A data: URI or bare base64.
  const comma = image.startsWith("data:") ? image.indexOf(",") : -1;
  const b64 = comma >= 0 ? image.slice(comma + 1) : image;
  const mimeType = image.startsWith("data:") ? image.slice(5, image.indexOf(";")) : "image/png";
  return { data: b64, mimeType };
}

function sniffMime(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return "image/webp";
  return "image/jpeg";
}

/** Image part shape on a generateContent response (camel + snake aliases). */
interface GeminiInline {
  mimeType?: string;
  mime_type?: string;
  data?: string;
}
interface GeminiImagePart {
  text?: string;
  inlineData?: GeminiInline;
  inline_data?: GeminiInline;
}

/** Map Gemini finishReason → the SDK's ChatStreamEvent finish reason. */
function mapGeminiFinish(reason: string | null): "end_turn" | "tool_calls" | "length" | "stop" {
  switch (reason) {
    case "MAX_TOKENS":
      return "length";
    case "STOP":
      return "end_turn";
    default:
      return reason ? "stop" : "end_turn";
  }
}
