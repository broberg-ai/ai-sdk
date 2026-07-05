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
export { requestyAdapter } from "./providers/requesty.js";
export { deepseekAdapter } from "./providers/deepseek.js";
export { mistralAdapter } from "./providers/mistral.js";
export { elevenlabsAdapter, ELEVENLABS_DANISH_VOICES, resolveVoice } from "./providers/elevenlabs.js";
export { azureAdapter, AZURE_DANISH_VOICES, AZURE_DANISH_VOICE_LIST, listAzureDanishVoices, resolveAzureVoice } from "./providers/azure.js";
export type { AzureVoiceInfo } from "./providers/azure.js";
export { vertexAdapter } from "./providers/vertex.js";
export { deeplAdapter } from "./providers/deepl.js";
export { falAdapter } from "./providers/fal.js";
export type { FalAdapterConfig } from "./providers/fal.js";
export { bflAdapter, bflCredits } from "./providers/bfl.js";
export type { BflAdapterConfig, BflCredits } from "./providers/bfl.js";
export { makeOpenAICompatibleAdapter } from "./providers/openai-compatible.js";
export type { OpenAICompatibleConfig } from "./providers/openai-compatible.js";
export { defaultProviders } from "./providers/registry.js";
export {
  anthropicApiAdapter,
  anthropicSubprocessAdapter,
  mistralStubAdapter,
  openaiStubAdapter,
  falStubAdapter,
  stubProviders,
} from "./providers/stub.js";
export { VERSION, SDK_TAG } from "./version.js";
export { DEFAULT_TIER_MAP, resolveTier } from "./routing/tier-map.js";
// F022 — Model Availability Harness: synchronous resolve + status read (spawn /
// call hot path) and an async background refresh. One registry, two consumers.
export { resolveModel, listModels, refreshAvailability, ModelUnavailableError, resetRegistry, resetRefreshState } from "./availability/index.js";
export type {
  ModelStatus,
  ResolveResult,
  AvailabilityStatus,
  AvailabilitySource,
  ResolveOptions,
  RefreshOptions,
  RefreshResult,
} from "./availability/index.js";
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
// F025 — cost READ-back: the canonical aggregation lives in Upmetrics; this thin,
// browser-clean client reads your own rolled-up cost from its cost read-API.
export { upmetricsCostClient, UpmetricsCostError, usdFromMicro } from "./cost/upmetrics-read.js";
export type {
  UpmetricsCostClientConfig,
  CostQuery,
  CostSummaryQuery,
  CostTimeseriesQuery,
  UpmetricsCostRow,
  UpmetricsCostSummary,
  UpmetricsCostTimeseries,
} from "./cost/upmetrics-read.js";
export { getPrice } from "./cost/pricing.js";
export type { PricingEntry } from "./cost/pricing.js";
export {
  httpTransport,
  subprocessTransport,
  parseClaudeCliJson,
  streamTransport,
  StreamHttpError,
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
  ChatStreamEvent,
  ImageRequest,
  ImageResult,
  LoraWeight,
  TrainStyleRequest,
  TrainStyleResult,
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
  VideoInput,
  TranslateInput,
  ImageInput,
  TrainStyleInput,
  EmbeddingInput,
  TranscribeInput,
  OcrInput,
  ModerationInput,
  PodcastInput,
  TtsInput,
} from "./schema/inputs.js";
export type {
  TranscribeRequest,
  TranscribeResult,
  OcrRequest,
  OcrResult,
  OcrPage,
  ModerationRequest,
  ModerationResult,
  ModerationItem,
  DialogueTurn,
  DialogueRequest,
  PodcastResult,
  TtsRequest,
  BatchRequestItem,
  BatchJob,
  BatchResultItem,
} from "./types.js";
