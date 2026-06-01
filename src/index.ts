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
export { computeCost, freshUsage } from "./cost/usage.js";
export { BudgetGuard, BudgetExceededError } from "./cost/budget.js";
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
} from "./schema/inputs.js";
