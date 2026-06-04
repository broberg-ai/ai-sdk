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
  | "video"
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
  | "video"
  | "translate"
  | "image"
  | "embedding"
  | "transcribe"
  | "ocr"
  | "moderation"
  | "podcast"
  | "tts"
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
  | { type: "image"; image: string | Uint8Array; mimeType?: string }
  | { type: "video"; video: string | Uint8Array; mimeType?: string };

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
  /** Consumer-defined attribution dimensions (e.g. {tenantId}) for per-tenant
   *  cost breakdown — the sink forwards these (F011). */
  labels?: Record<string, string>;
  ts: string;
  subprocess?: true;
}

/** A cost reporter. Fans `Usage` out to Upmetrics / Discord / sqlite / etc.
 *  Implementations must never throw into the caller (F3.3). */
export interface CostSink {
  record(usage: Usage): void | Promise<void>;
}

/** Backing store for a BudgetGuard's rolling total. Default is in-memory
 *  (per createAI instance). A persistent store (e.g. sqliteBudgetStore) makes
 *  the rolling budget survive restarts + shared across processes (F7.1). */
export interface BudgetStore {
  getSpent(): number | Promise<number>;
  addSpent(usd: number): void | Promise<void>;
}

/** Pre-flight budget ceilings, enforced before a call fires (F3.2). */
export interface BudgetConfig {
  /** Reject a single call whose estimated cost exceeds this many USD. */
  perCallUsd?: number;
  /** Reject once cumulative spend exceeds this many USD. */
  rollingUsd?: number;
  /** Where the rolling total lives. Omit for in-memory (per instance). */
  store?: BudgetStore;
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
  /** Consumer-defined attribution dimensions (e.g. {tenantId}) carried onto
   *  Usage and forwarded by the cost sink for per-tenant cost breakdown (F011). */
  labels?: Record<string, string>;
}

export interface ChatRequest {
  messages: Message[];
  spec: TierSpec;
  tools?: Tool[];
  maxTokens?: number;
  temperature?: number;
  /** "json" → request JSON-object output where the provider supports it (F009). */
  responseFormat?: "json" | "text";
}

export interface ChatResult {
  text: string;
  toolCalls?: ToolCall[];
  usage: Usage;
}

/** A single event from `ai.chatStream` / `adapter.chatStream` (F8). A streamed
 *  turn yields `text`/`tool_call` events as they arrive, one `usage` event when
 *  the provider reports totals, and a terminal `finish` (or `error`). Tool calls
 *  are emitted COMPLETE — accumulated across wire fragments, never partial. */
export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "usage"; costUsd: number; model: string; usage: Usage }
  | { type: "finish"; reason: "end_turn" | "tool_calls" | "length" | "stop" }
  | { type: "error"; message: string; status?: number };

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

export interface TranscribeRequest {
  /** Raw audio bytes (the client resolves a URL to bytes before calling). */
  audio: Uint8Array;
  language?: string;
  /** Audio length in seconds — enables per-minute cost (Whisper). Omit → cost 0. */
  durationSec?: number;
  spec: TierSpec;
}

export interface TranscribeResult {
  text: string;
  usage: Usage;
}

// OCR (F016.2) — document/image → structured text, billed per page.
export interface OcrRequest {
  /** A URL, data-URL, or raw bytes of the document/image. */
  document: string | Uint8Array;
  mimeType?: string;
  spec: TierSpec;
}
export interface OcrPage {
  index: number;
  markdown: string;
}
export interface OcrResult {
  pages: OcrPage[];
  usage: Usage;
}

// Moderation (F016.4) — classify text against safety categories, billed per token.
export interface ModerationRequest {
  input: string[];
  spec: TierSpec;
}
export interface ModerationItem {
  /** True if any category tripped. */
  flagged: boolean;
  categories: Record<string, boolean>;
  categoryScores: Record<string, number>;
}
export interface ModerationResult {
  results: ModerationItem[];
  usage: Usage;
}

// Podcast / multi-voice dialogue (F020) — a manuscript of speaker turns → one
// finished multi-voice audio episode. ElevenLabs Text-to-Dialogue, billed per char.
export interface DialogueTurn {
  text: string;
  voiceId: string;
}
export interface DialogueRequest {
  inputs: DialogueTurn[];
  /** Output container, e.g. "mp3" (default). */
  format?: string;
  spec: TierSpec;
}
export interface PodcastResult {
  /** Episode audio bytes. */
  audio: Uint8Array;
  mimeType: string;
  usage: Usage;
}

// Single-voice TTS (F020.4) — text → audio in one voice. ElevenLabs.
export interface TtsRequest {
  text: string;
  voiceId: string;
  spec: TierSpec;
}

/** The thin contract every provider implements (F4). A provider need only
 *  support the capabilities it offers — `chat` is the baseline; vision/image/
 *  embedding are optional and absence is a typed capability gap. */
export interface ProviderAdapter {
  readonly name: string;
  /** Every capability is optional — an adapter implements only what it supports
   *  (e.g. fal does image only). The client guards each call and throws a clear
   *  "provider X does not support Y" when a capability is absent. */
  chat?(req: ChatRequest): Promise<ChatResult>;
  /** Streaming chat (F8). Optional — absence is a typed "no streaming support".
   *  Same request shape as chat; yields ChatStreamEvents as the turn unfolds. */
  chatStream?(req: ChatRequest): AsyncIterable<ChatStreamEvent>;
  vision?(req: ChatRequest): Promise<ChatResult>;
  image?(req: ImageRequest): Promise<ImageResult>;
  embedding?(req: EmbeddingRequest): Promise<EmbeddingResult>;
  transcribe?(req: TranscribeRequest): Promise<TranscribeResult>;
  ocr?(req: OcrRequest): Promise<OcrResult>;
  moderate?(req: ModerationRequest): Promise<ModerationResult>;
  /** Multi-voice dialogue → one audio episode (F020). ElevenLabs. */
  dialogue?(req: DialogueRequest): Promise<PodcastResult>;
  /** Single-voice TTS (F020.4) → audio. ElevenLabs. */
  tts?(req: TtsRequest): Promise<PodcastResult>;
}

// ── Client config ──────────────────────────────────────────────────────────

// NOTE: AiConfig, the 5 capability inputs (ChatInput…EmbeddingInput) and the
// AiClient facade are defined in ./schema/inputs.ts — Zod schemas are the single
// source of truth and the types are derived via z.infer. They are not duplicated
// here. This file holds the base/wire types those schemas build on.

export interface TranslateResult {
  text: string;
  usage: Usage;
}
