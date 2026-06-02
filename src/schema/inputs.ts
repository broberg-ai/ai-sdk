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
  EmbeddingResult,
  TranscribeResult,
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
  ...callOptions,
});

export const translateInputSchema = z.object({
  text: z.string(),
  to: z.string(),
  from: z.string().optional(),
  ...callOptions,
});

export const imageInputSchema = z.object({
  prompt: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
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
  ...callOptions,
});

// ── Client config ──────────────────────────────────────────────────────────

export const budgetSchema = z.object({
  perCallUsd: z.number().positive().optional(),
  rollingUsd: z.number().positive().optional(),
});

export const aiConfigSchema = z.object({
  defaults: z.record(tierSchema, tierSpecSchema).optional(),
  // Functions can't be deeply validated — z.custom asserts the TS type and
  // passes the value through untouched.
  providers: z.record(z.string(), z.custom<ProviderAdapter>()).optional(),
  costSink: z.custom<CostSink>().optional(),
  budget: budgetSchema.optional(),
});

// ── Derived types (z.infer is the single source) ───────────────────────────

export type ChatInput = z.infer<typeof chatInputSchema>;
export type VisionInput = z.infer<typeof visionInputSchema>;
export type TranslateInput = z.infer<typeof translateInputSchema>;
export type ImageInput = z.infer<typeof imageInputSchema>;
export type EmbeddingInput = z.infer<typeof embeddingInputSchema>;
export type TranscribeInput = z.infer<typeof transcribeInputSchema>;
export type AiConfig = z.infer<typeof aiConfigSchema>;

/** The public facade. Defined here because it depends on the derived inputs. */
export interface AiClient {
  chat(input: ChatInput): Promise<ChatResult>;
  /** Streaming chat (F8) — same input as chat; yields ChatStreamEvents. The
   *  caller owns the tool-loop (per-turn engine, not an agent runtime). */
  chatStream(input: ChatInput): AsyncIterable<ChatStreamEvent>;
  vision(input: VisionInput): Promise<ChatResult>;
  translate(input: TranslateInput): Promise<TranslateResult>;
  image(input: ImageInput): Promise<ImageResult>;
  embedding(input: EmbeddingInput): Promise<EmbeddingResult>;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
  /** Prompt-contract capabilities (F5.5) layered on chat/vision. */
  contracts: Contracts;
}
