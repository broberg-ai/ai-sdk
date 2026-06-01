// @broberg/ai-sdk — public entry barrel.
// The facade is the only public surface; provider SDKs never leak through it.
export { VERSION, SDK_TAG } from "./version.js";
export { DEFAULT_TIER_MAP, resolveTier } from "./routing/tier-map.js";

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
} from "./types.js";
