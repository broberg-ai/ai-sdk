// Stub provider adapters (F2.5). They satisfy ProviderAdapter so the client wires
// up and resolves without real network calls. Real implementations land in F4
// (anthropic/openai/gemini/openrouter/deepinfra) and F5.3 (fal image). The stub
// usage carries zero tokens/cost — F3.1 fills real numbers in the live adapters.
import type {
  ProviderAdapter,
  ChatRequest,
  ChatResult,
  ImageRequest,
  ImageResult,
  EmbeddingRequest,
  EmbeddingResult,
  Usage,
  Capability,
} from "../types.js";

function stubUsage(
  provider: string,
  model: string,
  transport: "http" | "subprocess",
  capability: Capability,
): Usage {
  return {
    provider,
    model,
    transport,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    capability,
    // ts is supplied by the caller-side at real call time; stub uses a fixed marker
    // ('' avoids Date.now() — keeps the stub pure/deterministic for tests).
    ts: "",
  };
}

function lastUserText(req: ChatRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i];
    if (m && m.role === "user") {
      return typeof m.content === "string"
        ? m.content
        : m.content.map((p) => (p.type === "text" ? p.text : "[image]")).join(" ");
    }
  }
  return "";
}

/** Anthropic adapter stub (HTTP path). */
export const anthropicApiAdapter: ProviderAdapter = {
  name: "anthropic",
  async chat(req: ChatRequest): Promise<ChatResult> {
    return {
      text: `[stub:anthropic-api] ${lastUserText(req)}`,
      usage: stubUsage("anthropic", req.spec.model, "http", "chat"),
    };
  },
  async vision(req: ChatRequest): Promise<ChatResult> {
    return {
      text: `[stub:anthropic-api:vision] ${lastUserText(req)}`,
      usage: stubUsage("anthropic", req.spec.model, "http", "vision"),
    };
  },
};

/** Anthropic adapter stub (subprocess / `claude -p` path). */
export const anthropicSubprocessAdapter: ProviderAdapter = {
  name: "anthropic",
  async chat(req: ChatRequest): Promise<ChatResult> {
    const usage = stubUsage("anthropic", req.spec.model, "subprocess", "chat");
    usage.subprocess = true;
    return { text: `[stub:anthropic-subprocess] ${lastUserText(req)}`, usage };
  },
};

/** OpenAI adapter stub — covers the embedding default tier + a chat fallback. */
export const openaiStubAdapter: ProviderAdapter = {
  name: "openai",
  async chat(req: ChatRequest): Promise<ChatResult> {
    return {
      text: `[stub:openai] ${lastUserText(req)}`,
      usage: stubUsage("openai", req.spec.model, "http", "chat"),
    };
  },
  async embedding(req: EmbeddingRequest): Promise<EmbeddingResult> {
    return {
      vectors: req.input.map(() => [0, 0, 0]),
      usage: stubUsage("openai", req.spec.model, "http", "embedding"),
    };
  },
};

/** fal.ai adapter stub — image generation. */
export const falAdapter: ProviderAdapter = {
  name: "fal",
  async image(req: ImageRequest): Promise<ImageResult> {
    return {
      url: `https://stub.fal/${encodeURIComponent(req.prompt).slice(0, 32)}.png`,
      usage: stubUsage("fal", req.spec.model, "http", "image"),
    };
  },
};

/** Default provider registry wired when AiConfig.providers is absent. Keyed by
 *  provider name (matches TierSpec.provider). */
export const defaultProviders: Record<string, ProviderAdapter> = {
  anthropic: anthropicApiAdapter,
  openai: openaiStubAdapter,
  fal: falAdapter,
};
