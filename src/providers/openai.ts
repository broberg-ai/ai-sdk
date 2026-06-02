// OpenAI adapter (F4.1 chat/vision + F5.4 embedding). Chat/vision come from the
// shared OpenAI-compatible core; embedding uses the /embeddings endpoint. No
// openai npm package — plain fetch through httpTransport.
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import { httpTransport } from "../transport/http.js";
import { freshUsage } from "../cost/usage.js";
import type { ProviderAdapter, EmbeddingRequest, EmbeddingResult } from "../types.js";

export function openaiAdapter(
  config: { apiKey?: string; baseUrl?: string } = {},
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

  return { ...base, embedding };
}
