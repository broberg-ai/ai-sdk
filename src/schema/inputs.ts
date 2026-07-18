// Zod is the single source of truth for the public input shapes. The TypeScript
// types are derived via z.infer — no hand-written interface duplicates them.
// The client .parse()s every input at the boundary, so invalid input throws a
// ZodError before any provider work happens.
import { z } from "zod";
import type {
  ProviderAdapter,
  CostSink,
  TranslateResult,
  ChatResult,
  ChatStreamEvent,
  ImageResult,
  AnimateResult,
  TrainStyleResult,
  EmbeddingResult,
  TranscribeResult,
  OcrResult,
  ModerationResult,
  PodcastResult,
  BatchRequestItem,
  BatchJob,
  BatchResultItem,
  TierSpec,
} from "../types.js";
import type { Contracts } from "../capabilities/contracts/types.js";

// ── Reusable sub-schemas ───────────────────────────────────────────────────

export const transportSchema = z.enum(["http", "subprocess"]);

export const tierSchema = z.enum([
  "fast",
  "smart",
  "powerful",
  "cheap",
  "vision",
  "video",
  "embedding",
]);

export const tierSpecSchema = z.object({
  provider: z.string(),
  model: z.string(),
  transport: transportSchema,
});

export const toolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()),
});

export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});

export const contentPartSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image"),
    image: z.union([z.string(), z.instanceof(Uint8Array)]),
    mimeType: z.string().optional(),
  }),
]);

export const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(contentPartSchema)]),
  toolCalls: z.array(toolCallSchema).optional(),
  toolCallId: z.string().optional(),
});

/** Per-call options shared by every capability input. */
const callOptions = {
  tier: tierSchema.optional(),
  override: tierSpecSchema.partial().optional(),
  fallback: z.array(z.union([tierSchema, tierSpecSchema])).optional(),
  purpose: z.string().optional(),
  /** Consumer-defined attribution dimensions (e.g. {tenantId}) ridden into the
   *  cost sink for per-tenant/per-customer cost breakdown (F011). */
  labels: z.record(z.string(), z.string()).optional(),
} as const;

// ── The 5 capability inputs ────────────────────────────────────────────────

export const chatInputSchema = z.object({
  prompt: z.string().optional(),
  messages: z.array(messageSchema).optional(),
  system: z.string().optional(),
  tools: z.array(toolSchema).optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  /** "json" requests JSON-object output (OpenAI-compatible response_format). */
  responseFormat: z.enum(["json", "text"]).optional(),
  ...callOptions,
});

export const visionInputSchema = z.object({
  image: z.union([z.string(), z.instanceof(Uint8Array)]),
  prompt: z.string(),
  mimeType: z.string().optional(),
  /** System instruction — drives instruction-following far better than stuffing
   *  rules into `prompt` for instruction-heavy vision tasks (e.g. a JSON critic). */
  system: z.string().optional(),
  ...callOptions,
});

// F019 — analyze a video natively (e.g. "what's in the first 30s?"). Same shape
// as vision but with a video payload (URL, data-URL, or raw bytes).
export const videoInputSchema = z.object({
  video: z.union([z.string(), z.instanceof(Uint8Array)]),
  prompt: z.string(),
  mimeType: z.string().optional(),
  /** System instruction — same instruction-following benefit as on vision. */
  system: z.string().optional(),
  ...callOptions,
});

export const translateInputSchema = z.object({
  text: z.string(),
  to: z.string(),
  from: z.string().optional(),
  ...callOptions,
});

export const loraWeightSchema = z.object({
  path: z.string(),
  scale: z.number().optional(),
});

export const imageInputSchema = z.object({
  prompt: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** LoRAs to merge at inference (F021). */
  loras: z.array(loraWeightSchema).optional(),
  /** Shorthand for a single LoRA — normalized to loras:[{path, scale:1}]. */
  lora: z.string().optional(),
  /** F023 — a BFL finetune id (subject trained in the BFL dashboard). Routes to the
   *  EU-resident BFL finetuned-portrait endpoint. */
  finetune: z.string().optional(),
  /** F023 — BFL finetune_strength (~0–2; higher = stronger likeness). */
  finetuneStrength: z.number().min(0).max(2).optional(),
  /** F023.5 — 1–8 reference photos (URL or raw bytes) → EU-resident BFL FLUX 2
   *  multi-reference generation (likeness, no training step). */
  referenceImages: z.array(z.union([z.string(), z.instanceof(Uint8Array)])).min(1).max(8).optional(),
  /** F023.5 — fixed seed for reproducible output (BFL). */
  seed: z.number().int().optional(),
  /** F023.5 — output container (BFL FLUX 2). Default jpeg. */
  outputFormat: z.enum(["jpeg", "png", "webp"]).optional(),
  /** F023.5 — BFL content-moderation strictness, 0 (strict) … 6 (lax). Default 2. */
  safetyTolerance: z.number().int().min(0).max(6).optional(),
  /** F021.4 — re-roll once if fal returns a black image (NSFW false-positive). */
  retryOnBlack: z.boolean().optional(),
  ...callOptions,
});

// Image-to-video (F024) — animate a still into a short clip via a pluggable provider.
export const animateInputSchema = z.object({
  /** Input image: a URL or raw bytes (uploaded to fal storage). */
  image: z.union([z.string(), z.instanceof(Uint8Array)]),
  /** Motion/scene prompt. */
  prompt: z.string().optional(),
  /** Clip length in seconds (provider-dependent; Veo ≤ 8s). */
  durationSec: z.number().positive().optional(),
  /** e.g. "720p" / "1080p" (provider-dependent). */
  resolution: z.string().optional(),
  ...callOptions,
});

export const trainStyleInputSchema = z.object({
  /** A hosted archive URL, or an array of image URLs the SDK zips in-memory. */
  images: z.union([z.string(), z.array(z.string())]),
  /** Style LoRA (disables captioning/masks). Default true. */
  isStyle: z.boolean().optional(),
  triggerWord: z.string().optional(),
  steps: z.number().int().positive().optional(),
  createMasks: z.boolean().optional(),
  ...callOptions,
});

export const embeddingInputSchema = z.object({
  text: z.union([z.string(), z.array(z.string())]),
  ...callOptions,
});

export const transcribeInputSchema = z.object({
  /** Audio URL or raw bytes. */
  audio: z.union([z.string(), z.instanceof(Uint8Array)]),
  language: z.string().optional(),
  /** Audio length in seconds — enables Whisper per-minute cost. */
  durationSec: z.number().positive().optional(),
  /** Bias toward brand/jargon terms (Azure phraseList, F029.3); others ignore it. */
  phrases: z.array(z.string()).optional(),
  /** Opt-in timestamps (F036) — a single granularity or an array. Omit → the
   *  current { text, usage } shape, unchanged. Pass ["word","segment"] for both. */
  timestamps: z
    .union([z.enum(["word", "segment"]), z.array(z.enum(["word", "segment"]))])
    .optional(),
  ...callOptions,
});

// OCR (F016.2) — document/image → structured markdown text, billed per page.
export const ocrInputSchema = z.object({
  /** A URL, data-URL, or raw bytes of the document/image. */
  document: z.union([z.string(), z.instanceof(Uint8Array)]),
  /** image/* → routed as an image; anything else → a document (PDF etc.). */
  mimeType: z.string().optional(),
  ...callOptions,
});

// Moderation (F016.4) — classify text against safety categories, billed per token.
export const moderationInputSchema = z.object({
  input: z.union([z.string(), z.array(z.string())]),
  ...callOptions,
});

// Podcast (F020) — a finished manuscript (speaker turns) + a speaker→voiceId map →
// one finished multi-voice audio episode (ElevenLabs Text-to-Dialogue).
export const podcastInputSchema = z.object({
  script: z.array(z.object({ speaker: z.string(), text: z.string() })).min(1),
  voices: z.record(z.string(), z.string()),
  format: z.string().optional(),
  ...callOptions,
});

// Single-voice TTS (F020.4) — text → audio. `voice` is a curated name or a voiceId.
// `lang`/`format` (F026) are used by the Azure adapter; ElevenLabs ignores them.
export const ttsInputSchema = z.object({
  text: z.string(),
  voice: z.string(),
  lang: z.string().optional(),
  format: z.string().optional(),
  rate: z.number().positive().optional(),
  ...callOptions,
});

// ── Client config ──────────────────────────────────────────────────────────

export const budgetSchema = z.object({
  perCallUsd: z.number().positive().optional(),
  rollingUsd: z.number().positive().optional(),
});

/** F022 — opt-in proactive availability gate. Off by default so existing call
 *  sites are byte-identical. When autoResolve is on, a suspended primary model
 *  is transparently swapped to `fallback` before dispatch (synchronous, no I/O). */
export const availabilitySchema = z.object({
  autoResolve: z.boolean().optional(),
  fallback: z.union([z.string(), z.array(z.string())]).optional(),
});

export const aiConfigSchema = z.object({
  defaults: z.record(tierSchema, tierSpecSchema).optional(),
  // Functions can't be deeply validated — z.custom asserts the TS type and
  // passes the value through untouched.
  providers: z.record(z.string(), z.custom<ProviderAdapter>()).optional(),
  costSink: z.custom<CostSink>().optional(),
  budget: budgetSchema.optional(),
  availability: availabilitySchema.optional(),
});

// ── Derived types (z.infer is the single source) ───────────────────────────

export type ChatInput = z.infer<typeof chatInputSchema>;
export type VisionInput = z.infer<typeof visionInputSchema>;
export type VideoInput = z.infer<typeof videoInputSchema>;
export type TranslateInput = z.infer<typeof translateInputSchema>;
export type ImageInput = z.infer<typeof imageInputSchema>;
export type AnimateInput = z.infer<typeof animateInputSchema>;
export type TrainStyleInput = z.infer<typeof trainStyleInputSchema>;
export type EmbeddingInput = z.infer<typeof embeddingInputSchema>;
export type TranscribeInput = z.infer<typeof transcribeInputSchema>;
export type OcrInput = z.infer<typeof ocrInputSchema>;
export type ModerationInput = z.infer<typeof moderationInputSchema>;
export type PodcastInput = z.infer<typeof podcastInputSchema>;
export type TtsInput = z.infer<typeof ttsInputSchema>;
export type AiConfig = z.infer<typeof aiConfigSchema>;

/** The public facade. Defined here because it depends on the derived inputs. */
export interface AiClient {
  chat(input: ChatInput): Promise<ChatResult>;
  /** Streaming chat (F8) — same input as chat; yields ChatStreamEvents. The
   *  caller owns the tool-loop (per-turn engine, not an agent runtime). */
  chatStream(input: ChatInput): AsyncIterable<ChatStreamEvent>;
  vision(input: VisionInput): Promise<ChatResult>;
  /** Video Vision (F019) — analyze a video natively. Default tier: "video". */
  video(input: VideoInput): Promise<ChatResult>;
  translate(input: TranslateInput): Promise<TranslateResult>;
  image(input: ImageInput): Promise<ImageResult>;
  /** Image-to-video (F024) — animate a still into a short clip → { url, usage }. fal. */
  animate(input: AnimateInput): Promise<AnimateResult>;
  /** Train a style/brand LoRA from images (F021) → { loraUrl, configUrl }. fal. */
  trainStyle(input: TrainStyleInput): Promise<TrainStyleResult>;
  embedding(input: EmbeddingInput): Promise<EmbeddingResult>;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
  /** OCR (F016.2) — document/image → structured markdown, billed per page. Mistral. */
  ocr(input: OcrInput): Promise<OcrResult>;
  /** Moderation (F016.4) — classify text against safety categories. Mistral. */
  moderate(input: ModerationInput): Promise<ModerationResult>;
  /** Podcast (F020) — a finished manuscript → one multi-voice audio episode. ElevenLabs. */
  podcast(input: PodcastInput): Promise<PodcastResult>;
  /** Single-voice TTS (F020.4) — text → audio. `voice` = curated name or voiceId. ElevenLabs. */
  tts(input: TtsInput): Promise<PodcastResult>;
  /** Batch (F016.1) — submit many chat requests for async (≤24h) processing at 50% cost. Mistral. */
  batch: {
    submit(input: { requests: BatchRequestItem[]; override?: TierSpec }): Promise<BatchJob>;
    status(jobId: string, override?: TierSpec): Promise<BatchJob>;
    results(jobId: string, override?: TierSpec): Promise<BatchResultItem[]>;
  };
  /** Prompt-contract capabilities (F5.5) layered on chat/vision. */
  contracts: Contracts;
}
