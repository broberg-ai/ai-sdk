// Core type contract for @broberg/ai-sdk.
// Types + interfaces only — no runtime code lives here. Implementations land in
// their own modules (transports, adapters, capabilities, cost). The shapes that
// later stories reference (Usage, Tool, CostSink, Budget) are defined here so the
// whole tree compiles against one contract.

// ── Transport + routing ────────────────────────────────────────────────────

/** How a call reaches the model. `http` = provider REST API; `subprocess` = local
 *  `claude -p` CLI (Max plan, costUsd 0). */
export type Transport = "http" | "subprocess";

/** Named capability tier. Resolves to a (provider, model, transport) triple via
 *  the tier map, overridable per call. */
export type Tier =
  | "fast"
  | "smart"
  | "powerful"
  | "cheap"
  | "vision"
  | "embedding";

/** The concrete routing target a Tier (or a per-call override) resolves to. */
export interface TierSpec {
  provider: string;
  model: string;
  transport: Transport;
}

/** High-level capability a call exercises. Mirrors the capability layer (F5). */
export type Capability =
  | "chat"
  | "vision"
  | "translate"
  | "image"
  | "embedding"
  | "transcribe"
  | "mockup"
  | "design"
  | "extract"
  | "classify"
  | "rerank";

// ── Messages + tools ───────────────────────────────────────────────────────

export type Role = "system" | "user" | "assistant" | "tool";

/** A piece of message content. Text everywhere; image parts feed vision. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string | Uint8Array; mimeType?: string };

export interface Message {
  role: Role;
  content: string | ContentPart[];
  /** Set on assistant messages that called tools. */
  toolCalls?: ToolCall[];
  /** Set on `tool` role messages — which call this result answers. */
  toolCallId?: string;
}

/** SDK-level tool definition. Adapters convert this to each provider's format
 *  (F4.5). `parameters` is a JSON Schema object. */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A model's request to invoke a tool, normalized across providers (F4.5). */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ── Usage + cost ───────────────────────────────────────────────────────────

/** Per-call usage. Fields mirror the upmetrics `agent_runs` schema 1:1 so the
 *  upmetricsSink (F3.7) forwards without re-mapping. `costUsd` is 0 for
 *  subprocess (Max plan); `subprocess:true` lets dashboards split free vs paid. */
export interface Usage {
  provider: string;
  model: string;
  tier?: Tier;
  transport: Transport;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  toolCalls?: { name: string; count: number; errorCount?: number }[];
  latencyMs: number;
  capability: Capability;
  purpose?: string;
  ts: string;
  subprocess?: true;
}

/** A cost reporter. Fans `Usage` out to Upmetrics / Discord / sqlite / etc.
 *  Implementations must never throw into the caller (F3.3). */
export interface CostSink {
  record(usage: Usage): void | Promise<void>;
}

/** Pre-flight budget ceilings, enforced before a call fires (F3.2). */
export interface BudgetConfig {
  /** Reject a single call whose estimated cost exceeds this many USD. */
  perCallUsd?: number;
  /** Reject once cumulative spend on this client instance exceeds this many USD. */
  rollingUsd?: number;
}

// ── Provider adapter contract ──────────────────────────────────────────────

/** Per-call options shared by every capability: which tier, optional routing
 *  override, optional fallback chain, and a free-text purpose for cost reports. */
export interface CallOptions {
  tier?: Tier;
  /** Override any part of the resolved TierSpec for this call only. */
  override?: Partial<TierSpec>;
  /** Ordered fallbacks tried if the primary route errors (inventory finding:
   *  cms/trail/sanne/xrt81 all hand-roll this — make it first-class). */
  fallback?: (Tier | TierSpec)[];
  purpose?: string;
}

export interface ChatRequest {
  messages: Message[];
  spec: TierSpec;
  tools?: Tool[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResult {
  text: string;
  toolCalls?: ToolCall[];
  usage: Usage;
}

export interface ImageRequest {
  prompt: string;
  spec: TierSpec;
  width?: number;
  height?: number;
}

export interface ImageResult {
  url: string;
  usage: Usage;
}

export interface EmbeddingRequest {
  input: string[];
  spec: TierSpec;
}

export interface EmbeddingResult {
  vectors: number[][];
  usage: Usage;
}

/** The thin contract every provider implements (F4). A provider need only
 *  support the capabilities it offers — `chat` is the baseline; vision/image/
 *  embedding are optional and absence is a typed capability gap. */
export interface ProviderAdapter {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResult>;
  vision?(req: ChatRequest): Promise<ChatResult>;
  image?(req: ImageRequest): Promise<ImageResult>;
  embedding?(req: EmbeddingRequest): Promise<EmbeddingResult>;
}

// ── Client config ──────────────────────────────────────────────────────────

/** Input to `createAI()`. All optional — an empty config yields a client whose
 *  calls resolve via DEFAULT_TIER_MAP with no cost sink and no budget guard. */
export interface AiConfig {
  /** Per-tier routing overrides merged on top of DEFAULT_TIER_MAP. */
  defaults?: Partial<Record<Tier, TierSpec>>;
  /** Provider adapters by name, e.g. { anthropic, openai, fal }. */
  providers?: Record<string, ProviderAdapter>;
  /** Where per-call Usage is reported. Omit for no reporting. */
  costSink?: CostSink;
  /** Pre-flight spend ceilings. Omit for no guard. */
  budget?: BudgetConfig;
}
