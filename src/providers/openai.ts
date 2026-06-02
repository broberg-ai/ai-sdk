// OpenAI adapter (F4.1 chat/vision + F5.4 embedding). Chat/vision come from the
// shared OpenAI-compatible core; embedding uses the /embeddings endpoint. No
// openai npm package — plain fetch through httpTransport.
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import { httpTransport } from "../transport/http.js";
import { freshUsage } from "../cost/usage.js";
import type {
  ProviderAdapter,
  EmbeddingRequest,
  EmbeddingResult,
  TranscribeRequest,
  TranscribeResult,
} from "../types.js";

export function openaiAdapter(
  config: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch } = {},
): ProviderAdapter {
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const base = makeOpenAICompatibleAdapter({ name: "openai", baseUrl, apiKey: config.apiKey });

  async function embedding(req: EmbeddingRequest): Promise<EmbeddingResult> {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("openai adapter: API key not set (env OPENAI_API_KEY)");
    const res = await httpTransport({
      spec: req.spec,
      http: {
        url: `${baseUrl}/embeddings`,
        headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: { model: req.spec.model, input: req.input },
      },
    });
    if (!res.ok) {
      throw new Error(`openai ${res.status}: ${JSON.stringify(res.json).slice(0, 300)}`);
    }
    const data = res.json as {
      data?: { embedding: number[] }[];
      usage?: { prompt_tokens?: number };
    };
    const vectors = (data.data ?? []).map((d) => d.embedding);
    const usage = freshUsage({
      provider: "openai",
      model: req.spec.model,
      transport: "http",
      capability: "embedding",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: 0,
    });
    return { vectors, usage };
  }

  async function transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("openai adapter: API key not set (env OPENAI_API_KEY)");
    // Whisper is multipart/form-data — bypass httpTransport (JSON-only). Don't set
    // content-type; fetch adds the multipart boundary.
    const form = new FormData();
    form.append("file", new Blob([req.audio]), "audio");
    form.append("model", req.spec.model);
    if (req.language) form.append("language", req.language);
    const fetchImpl = config.fetch ?? fetch;
    const res = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`openai ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    const data = (await res.json()) as { text?: string };
    const usage = freshUsage({
      provider: "openai",
      model: req.spec.model,
      transport: "http",
      capability: "transcribe",
      inputTokens: 0,
      outputTokens: 0, // Whisper is per-minute, not token-priced; cost stays 0 for v1.
    });
    return { text: data.text ?? "", usage };
  }

  return { ...base, embedding, transcribe };
}
