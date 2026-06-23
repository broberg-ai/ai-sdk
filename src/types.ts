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
  | "animate"
  | "embedding"
  | "transcribe"
  | "ocr"
  | "moderation"
  | "podcast"
  | "tts"
  | "trainStyle"
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

/** A trained LoRA to merge at inference time (F021). */
export interface LoraWeight {
  /** URL (or fal path) to the LoRA weights. */
  path: string;
  /** Scales the LoRA before merging (default 1). */
  scale?: number;
}

export interface ImageRequest {
  prompt: string;
  spec: TierSpec;
  width?: number;
  height?: number;
  /** LoRAs to merge at inference (F021) — e.g. a trained brand/style LoRA. */
  loras?: LoraWeight[];
  /** F023 — a BFL finetune id (a subject trained in the BFL dashboard). Routes to the
   *  EU-resident BFL finetuned-portrait endpoint. */
  finetune?: string;
  /** F023 — how strongly the finetune is applied (BFL finetune_strength, ~0–2). */
  finetuneStrength?: number;
  /** F023.5 — 1–8 reference photos of a subject (URL or raw bytes). Routes to the
   *  EU-resident BFL FLUX 2 multi-reference endpoint — generate a likeness with NO
   *  training step. Bytes are base64-inlined into the EU call (no cross-region fetch). */
  referenceImages?: (string | Uint8Array)[];
  /** F023.5 — fixed seed for reproducible output (BFL). */
  seed?: number;
  /** F023.5 — output container (BFL FLUX 2): "jpeg" | "png" | "webp". Default jpeg. */
  outputFormat?: "jpeg" | "png" | "webp";
  /** F023.5 — BFL content-moderation strictness, 0 (strict) … 6 (lax). Default 2. */
  safetyTolerance?: number;
  /** F021.4 — re-roll once with a fresh seed if fal's safety-checker false-positives
   *  and returns a black image (has_nsfw_concepts). fal only. */
  retryOnBlack?: boolean;
}

export interface ImageResult {
  url: string;
  usage: Usage;
}

/** Image-to-video generation (F024) — animate a still into a short clip. */
export interface AnimateRequest {
  /** Input image: a URL (passed through) or raw bytes (uploaded to fal storage). */
  image: string | Uint8Array;
  /** Motion/scene prompt, e.g. "the subject turns and smiles". */
  prompt?: string;
  /** Clip length in seconds (provider-dependent; Veo ≤ 8s). */
  durationSec?: number;
  /** e.g. "720p" / "1080p" (provider-dependent). */
  resolution?: string;
  spec: TierSpec;
}

export interface AnimateResult {
  /** URL to the generated video. For fal this is a public hosted URL; for the
   *  Gemini/Veo route it is Google's file URI (needs the API key to fetch — the
   *  bytes are also returned below, already downloaded). */
  url: string;
  /** The downloaded video bytes — set by providers whose result URL is auth-gated
   *  or short-lived (Gemini/Veo). Absent for providers that return a public URL (fal). */
  bytes?: Uint8Array;
  /** MIME type of `bytes` (e.g. "video/mp4"). */
  mimeType?: string;
  usage: Usage;
}

/** Style/brand LoRA training (F021) — fal fal-ai/flux-lora-fast-training. */
export interface TrainStyleRequest {
  /** A hosted archive URL, or an array of image URLs the SDK zips in-memory. */
  images: string | string[];
  spec: TierSpec;
  /** Style LoRA (disables captioning/masks). Default true. */
  isStyle?: boolean;
  triggerWord?: string;
  /** Training steps (~1000 typical). */
  steps?: number;
  createMasks?: boolean;
}

export interface TrainStyleResult {
  /** URL to the trained LoRA weights — pass to ai.image({ lora }). */
  loraUrl: string;
  /** URL to the training config file. */
  configUrl: string;
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

// Single-voice TTS (F020.4) — text → audio in one voice. ElevenLabs or Azure (F026).
export interface TtsRequest {
  text: string;
  voiceId: string;
  /** BCP-47 locale (e.g. "da-DK"). Azure uses it for SSML xml:lang; ElevenLabs ignores it. */
  lang?: string;
  /** Provider output-format hint (e.g. an Azure X-Microsoft-OutputFormat); ElevenLabs ignores it. */
  format?: string;
  /** Speaking-rate multiplier (Azure): 1 = normal, 0.9 = 10% slower, 1.1 = faster. ElevenLabs ignores it. */
  rate?: number;
  spec: TierSpec;
}

// Batch (F016.1) — submit many chat requests for async (≤24h) processing at 50% cost.
export interface BatchRequestItem {
  customId: string;
  prompt: string;
}
export interface BatchJob {
  jobId: string;
  status: string;
  total?: number;
  completed?: number;
}
export interface BatchResultItem {
  customId: string;
  text: string;
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
  /** Image-to-video generation (F024) — animate a still into a short clip. fal. */
  animate?(req: AnimateRequest): Promise<AnimateResult>;
  /** Train a style/brand LoRA from images (F021). fal. */
  trainStyle?(req: TrainStyleRequest): Promise<TrainStyleResult>;
  embedding?(req: EmbeddingRequest): Promise<EmbeddingResult>;
  transcribe?(req: TranscribeRequest): Promise<TranscribeResult>;
  ocr?(req: OcrRequest): Promise<OcrResult>;
  moderate?(req: ModerationRequest): Promise<ModerationResult>;
  /** Multi-voice dialogue → one audio episode (F020). ElevenLabs. */
  dialogue?(req: DialogueRequest): Promise<PodcastResult>;
  /** Single-voice TTS (F020.4) → audio. ElevenLabs. */
  tts?(req: TtsRequest): Promise<PodcastResult>;
  /** Batch (F016.1) — async chat-request processing at 50% cost. Mistral. */
  batchSubmit?(req: { items: BatchRequestItem[]; spec: TierSpec }): Promise<BatchJob>;
  batchStatus?(req: { jobId: string; spec: TierSpec }): Promise<BatchJob>;
  batchResults?(req: { jobId: string; spec: TierSpec }): Promise<BatchResultItem[]>;
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
