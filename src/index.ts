// @broberg/ai-sdk — public entry barrel.
// The facade is the only public surface; provider SDKs never leak through it.
export { createAI } from "./client.js";
export { makeContracts, parseJsonLoose } from "./capabilities/contracts/index.js";
export type {
  Contracts,
  MockupInput,
  MockupResult,
  DesignInput,
  DesignResult,
  ExtractInput,
  ExtractResult,
  ClassifyInput,
  ClassifyResult,
  RerankInput,
  RerankResult,
} from "./capabilities/contracts/types.js";
export { toProviderTools, fromProviderToolCall } from "./providers/tools.js";
export { anthropicAdapter } from "./providers/anthropic.js";
export { openaiAdapter } from "./providers/openai.js";
export { geminiAdapter } from "./providers/gemini.js";
export { deepinfraAdapter } from "./providers/deepinfra.js";
export { openrouterAdapter } from "./providers/openrouter.js";
export { falAdapter } from "./providers/fal.js";
export type { FalAdapterConfig } from "./providers/fal.js";
export { makeOpenAICompatibleAdapter } from "./providers/openai-compatible.js";
export type { OpenAICompatibleConfig } from "./providers/openai-compatible.js";
export { defaultProviders } from "./providers/registry.js";
export {
  anthropicApiAdapter,
  anthropicSubprocessAdapter,
  openaiStubAdapter,
  falStubAdapter,
  stubProviders,
} from "./providers/stub.js";
export { VERSION, SDK_TAG } from "./version.js";
export { DEFAULT_TIER_MAP, resolveTier } from "./routing/tier-map.js";
export { computeCost, freshUsage } from "./cost/usage.js";
export { BudgetGuard, BudgetExceededError } from "./cost/budget.js";
export { sqliteBudgetStore } from "./cost/budget-store.js";
export type { SqliteBudgetStoreConfig } from "./cost/budget-store.js";
export {
  noopSink,
  multiSink,
  upmetricsSink,
  discordSink,
  sqliteSink,
  getCostSummary,
} from "./cost/sinks/index.js";
export type {
  UpmetricsSinkConfig,
  DiscordSinkConfig,
  SqliteSinkConfig,
  CostSummary,
} from "./cost/sinks/index.js";
export { getPrice } from "./cost/pricing.js";
export type { PricingEntry } from "./cost/pricing.js";
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
  BudgetStore,
  CallOptions,
  ChatRequest,
  ChatResult,
  ImageRequest,
  ImageResult,
  EmbeddingRequest,
  EmbeddingResult,
  ProviderAdapter,
  TranslateResult,
} from "./types.js";

// Public input shapes + facade type — Zod-derived (single source of truth).
export {
  chatInputSchema,
  visionInputSchema,
  translateInputSchema,
  imageInputSchema,
  embeddingInputSchema,
  aiConfigSchema,
  messageSchema,
  toolSchema,
  tierSpecSchema,
} from "./schema/inputs.js";
export type {
  AiConfig,
  AiClient,
  ChatInput,
  VisionInput,
  TranslateInput,
  ImageInput,
  EmbeddingInput,
  TranscribeInput,
} from "./schema/inputs.js";
export type { TranscribeRequest, TranscribeResult } from "./types.js";
