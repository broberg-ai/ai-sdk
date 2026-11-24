// F095 — local embeddings: a model running on one of our own machines (Ollama,
// llama.cpp server, LM Studio — all speak OpenAI's /v1/embeddings), so a batch job
// can embed text at $0 instead of a metered API. Owner 2026-11-24: «så skal vi ikke
// bruge AI tokens på det»; model chosen the same day: bge-m3 (1024 dims).
//
// Ship dark: no server → a clear error naming the address. The SDK never falls back
// on its own, so an unreachable local model can never turn into a paid call.
import type { EmbeddingRequest, EmbeddingResult, ProviderAdapter } from "../types.js";
import { httpTransport, errorBody } from "../transport/http.js";
import { freshUsage } from "../cost/usage.js";
import { regionOfHost } from "../cost/region.js";
import { env } from "../env.js";

/** Ollama's OpenAI-compatible endpoint on the same machine. */
export const LOCAL_EMBEDDING_DEFAULT_URL = "http://127.0.0.1:11434/v1";

export interface LocalAdapterConfig {
  /** Server base URL incl. /v1. Else env LOCAL_EMBEDDING_URL, else Ollama on 127.0.0.1. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function localAdapter(config: LocalAdapterConfig = {}): ProviderAdapter {
  const baseUrl = () => (config.baseUrl ?? env().LOCAL_EMBEDDING_URL ?? LOCAL_EMBEDDING_DEFAULT_URL).replace(/\/$/, "");

  async function embedding(req: EmbeddingRequest): Promise<EmbeddingResult> {
    const url = baseUrl();
    const model = req.spec.model;
    let res;
    try {
      res = await httpTransport({
        spec: req.spec,
        fetch: config.fetch,
        // No key: a local server needs none, and none is ever sent.
        http: { url: `${url}/embeddings`, headers: { "content-type": "application/json" }, body: { model, input: req.input } },
      });
    } catch (e) {
      throw new Error(
        `local embedding server not reachable at ${url} (${(e as Error).message}). ` +
          `Start it (e.g. \`ollama serve\`) or set LOCAL_EMBEDDING_URL. Nothing was sent to any other provider.`,
        { cause: e },
      );
    }
    if (res.status === 404) {
      throw new Error(`local embedding model "${model}" is not available at ${url} — pull it first: \`ollama pull ${model}\`. (${errorBody(res.json, res.text)})`);
    }
    if (!res.ok) throw new Error(`local embedding ${res.status} at ${url}: ${errorBody(res.json, res.text)}`);
    const data = res.json as { data?: { embedding: number[] }[]; usage?: { prompt_tokens?: number } };
    const vectors = (data.data ?? []).map((d) => d.embedding);
    if (vectors.length !== req.input.length) {
      throw new Error(`local embedding at ${url} returned ${vectors.length} vectors for ${req.input.length} inputs`);
    }
    const usage = freshUsage({
      provider: "local",
      model,
      transport: "http",
      capability: "embedding",
      region: regionOfHost(url),
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: 0,
    });
    // A known, genuine $0 — not a price-table gap («unpriced»).
    usage.costUsd = 0;
    usage.costBasis = "computed";
    return { vectors, usage };
  }

  return { name: "local", embedding };
}
