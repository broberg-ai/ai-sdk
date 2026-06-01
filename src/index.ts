// @broberg/ai-sdk — public entry barrel.
// The facade is the only public surface; provider SDKs never leak through it.
export { createAI } from "./client.js";
export {
  anthropicApiAdapter,
  anthropicSubprocessAdapter,
  openaiStubAdapter,
  falAdapter,
  defaultProviders,
} from "./providers/stub.js";
export { VERSION, SDK_TAG } from "./version.js";
export { DEFAULT_TIER_MAP, resolveTier } from "./routing/tier-map.js";
export {
  httpTransport,
  subprocessTransport,
  parseClaudeCliJson,
} from "./transport/index.js";
export type {
  TransportRequest,
  TransportResponse,
  HttpResponse,
  SubprocessResponse,
} from "./transport/index.js";

export type {
  Transport,
  Tier,
  TierSpec,
  Capability,
  Role,
  ContentPart,
  Message,
  Tool,
  ToolCall,
  Usage,
  CostSink,
  BudgetConfig,
  CallOptions,
  ChatRequest,
  ChatResult,
  ImageRequest,
  ImageResult,
  EmbeddingRequest,
  EmbeddingResult,
  ProviderAdapter,
  AiConfig,
  ChatInput,
  VisionInput,
  TranslateInput,
  ImageInput,
  EmbeddingInput,
  TranslateResult,
  AiClient,
} from "./types.js";
