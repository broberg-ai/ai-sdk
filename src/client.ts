// createAI() — the facade factory. Resolves routing, picks a provider adapter,
// delegates the call, stamps call-context metadata onto Usage, and reports to the
// cost sink. Provider specifics live in adapters; cost compute/budget land in F3.
import { resolveTier } from "./routing/tier-map.js";
import { defaultProviders } from "./providers/registry.js";
import { computeCost } from "./cost/usage.js";
import { BudgetGuard } from "./cost/budget.js";
import { buildVisionMessages, VISION_DEFAULT_TIER } from "./capabilities/vision.js";
import { buildVideoMessages, VIDEO_DEFAULT_TIER } from "./capabilities/video.js";
import { buildTranslateMessages, TRANSLATE_DEFAULT_TIER } from "./capabilities/translate.js";
import { EMBEDDING_DEFAULT_TIER } from "./capabilities/embedding.js";
import { DEFAULT_TRANSCRIBE_SPEC, resolveAudio } from "./capabilities/transcribe.js";
import { makeContracts } from "./capabilities/contracts/index.js";
import {
  aiConfigSchema,
  chatInputSchema,
  visionInputSchema,
  videoInputSchema,
  translateInputSchema,
  imageInputSchema,
  embeddingInputSchema,
  transcribeInputSchema,
} from "./schema/inputs.js";
import type {
  AiConfig,
  AiClient,
  ChatInput,
  VisionInput,
  VideoInput,
  TranslateInput,
  ImageInput,
  EmbeddingInput,
  TranscribeInput,
} from "./schema/inputs.js";
import type {
  ChatResult,
  ChatStreamEvent,
  ImageResult,
  EmbeddingResult,
  TranscribeResult,
  TranslateResult,
  ProviderAdapter,
  Message,
  Capability,
  Tier,
  TierSpec,
  Usage,
} from "./types.js";

/** Built-in image route (no image tier in the tier map — fal owns its routing). */
const DEFAULT_IMAGE_SPEC: TierSpec = {
  provider: "fal",
  model: "fal-ai/flux/schnell",
  transport: "http",
};

export function createAI(config: AiConfig = {}): AiClient {
  // Validate config at the boundary (throws ZodError on bad shape).
  const cfg = aiConfigSchema.parse(config);
  const providers = cfg.providers ?? defaultProviders;
  const budget = cfg.budget ? new BudgetGuard(cfg.budget) : undefined;

  const estTokens = (s: string): number => Math.ceil(s.length / 4);

  /** Pre-flight budget check. Estimates this call's cost and throws
   *  BudgetExceededError before the transport fires. No-op without a budget. */
  async function preflight(spec: TierSpec, estInTokens: number, estOutTokens: number): Promise<void> {
    if (!budget) return;
    await budget.check(computeCost(spec.provider, spec.model, estInTokens, estOutTokens));
  }

  /** Fold the actual cost into the rolling total after a successful call. */
  async function settle(usage: Usage): Promise<void> {
    if (budget) await budget.record(usage.costUsd);
  }

  function pickProvider(name: string): ProviderAdapter {
    const adapter = providers[name];
    if (!adapter) {
      throw new Error(
        `createAI: no provider adapter registered for "${name}". Registered: ${Object.keys(providers).join(", ") || "(none)"}`,
      );
    }
    return adapter;
  }

  /** Stamp call-context metadata the client owns onto the adapter's Usage:
   *  capability, tier, purpose, the wall-clock latency, and the timestamp. */
  function enrich(
    usage: Usage,
    capability: Capability,
    tier: Tier | undefined,
    purpose: string | undefined,
    latencyMs: number,
    labels: Record<string, string> | undefined,
  ): Usage {
    usage.capability = capability;
    if (tier) usage.tier = tier;
    if (purpose) usage.purpose = purpose;
    if (labels && Object.keys(labels).length > 0) usage.labels = labels;
    usage.latencyMs = Math.round(latencyMs);
    if (!usage.ts) usage.ts = new Date().toISOString();
    return usage;
  }

  async function report(usage: Usage): Promise<void> {
    if (!cfg.costSink) return;
    try {
      await cfg.costSink.record(usage);
    } catch {
      // A broken sink must never crash a real AI call (F3.3 invariant).
    }
  }

  function toMessages(input: ChatInput): Message[] {
    if (input.messages && input.messages.length > 0) return input.messages;
    const msgs: Message[] = [];
    if (input.system) msgs.push({ role: "system", content: input.system });
    msgs.push({ role: "user", content: input.prompt ?? "" });
    return msgs;
  }

  /** Run a capability with an optional fallback chain. Tries the primary route,
   *  then each fallback (Tier or TierSpec) in order if the call errors. A budget
   *  breach propagates immediately (not a fallback trigger). On the first
   *  success: stamp Usage, settle the budget, report to the sink, return. */
  async function runCapability<R extends { usage: Usage }>(opts: {
    primary: TierSpec;
    fallback?: (Tier | TierSpec)[];
    capability: Capability;
    tier?: Tier;
    purpose?: string;
    labels?: Record<string, string>;
    estIn: number;
    estOut: number;
    invoke: (spec: TierSpec) => Promise<R>;
  }): Promise<R> {
    const routes: TierSpec[] = [
      opts.primary,
      ...(opts.fallback ?? []).map((f) =>
        typeof f === "string" ? resolveTier(f, undefined, cfg.defaults) : f,
      ),
    ];
    let lastErr: unknown;
    for (let i = 0; i < routes.length; i++) {
      const spec = routes[i]!;
      await preflight(spec, opts.estIn, opts.estOut); // BudgetExceededError propagates
      try {
        const t0 = performance.now();
        const res = await opts.invoke(spec);
        enrich(res.usage, opts.capability, i === 0 ? opts.tier : undefined, opts.purpose, performance.now() - t0, opts.labels);
        await settle(res.usage);
        await report(res.usage);
        return res;
      } catch (e) {
        lastErr = e; // try the next fallback route
      }
    }
    throw lastErr;
  }

  /** Whether a pre-first-token streaming error should fall back to the next
   *  route. Eligible: network/timeout/parse (no status) + 429 + 5xx. Hard 4xx
   *  bubbles up (no silent re-route) — sa contract #2565. */
  function eligibleForFallback(e: unknown): boolean {
    const status = (e as { status?: number } | null)?.status;
    if (status === undefined) return true;
    return status === 429 || status >= 500;
  }

  function errorEvent(e: unknown): ChatStreamEvent {
    const ev: ChatStreamEvent = {
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    };
    const status = (e as { status?: number } | null)?.status;
    if (status !== undefined) ev.status = status;
    return ev;
  }

  /** Streaming chat with pre-stream fallback (F8.1). Yields ChatStreamEvents as
   *  the turn unfolds. Fallback re-routes only BEFORE the first text/tool_call
   *  event (deltas can't be un-emitted); once streaming has begun, an error is
   *  surfaced as an error event and the stream ends. Budget breaches propagate. */
  async function* chatStreamImpl(input: ChatInput): AsyncIterable<ChatStreamEvent> {
    input = chatInputSchema.parse(input);
    const tier = input.tier ?? "smart";
    const messages = toMessages(input);
    const estIn = messages.reduce(
      (n, m) => n + estTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content)),
      0,
    );
    const estOut = input.maxTokens ?? 512;
    const routes: TierSpec[] = [
      resolveTier(tier, input.override, cfg.defaults),
      ...(input.fallback ?? []).map((f) =>
        typeof f === "string" ? resolveTier(f, undefined, cfg.defaults) : f,
      ),
    ];

    let lastErr: unknown;
    for (let i = 0; i < routes.length; i++) {
      const spec = routes[i]!;
      await preflight(spec, estIn, estOut); // BudgetExceededError propagates
      const adapter = pickProvider(spec.provider);
      if (!adapter.chatStream) {
        throw new Error(`createAI: provider "${spec.provider}" does not support streaming`);
      }
      const t0 = performance.now();
      let emitted = false;
      try {
        for await (const ev of adapter.chatStream({
          messages,
          spec,
          tools: input.tools,
          maxTokens: input.maxTokens,
          temperature: input.temperature,
          responseFormat: input.responseFormat,
        })) {
          if (ev.type === "text" || ev.type === "tool_call") emitted = true;
          if (ev.type === "usage") {
            enrich(ev.usage, "chat", i === 0 ? tier : undefined, input.purpose, performance.now() - t0, input.labels);
            await settle(ev.usage);
            await report(ev.usage);
          }
          yield ev;
        }
        return; // stream completed cleanly
      } catch (e) {
        lastErr = e;
        if (emitted || !eligibleForFallback(e)) {
          yield errorEvent(e); // mid-stream or hard error → surface + stop
          return;
        }
        // pre-first-token eligible error → try the next route
      }
    }
    yield errorEvent(lastErr);
  }

  const client: AiClient = {
    async chat(input: ChatInput): Promise<ChatResult> {
      input = chatInputSchema.parse(input);
      const tier = input.tier ?? "smart";
      const messages = toMessages(input);
      const estIn = messages.reduce(
        (n, m) => n + estTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content)),
        0,
      );
      return runCapability({
        primary: resolveTier(tier, input.override, cfg.defaults),
        fallback: input.fallback,
        capability: "chat",
        tier,
        purpose: input.purpose,
        labels: input.labels,
        estIn,
        estOut: input.maxTokens ?? 512,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.chat) throw new Error(`createAI: provider "${spec.provider}" does not support chat`);
          return adapter.chat({ messages, spec, tools: input.tools, maxTokens: input.maxTokens, temperature: input.temperature, responseFormat: input.responseFormat });
        },
      });
    },

    chatStream: chatStreamImpl,

    async vision(input: VisionInput): Promise<ChatResult> {
      input = visionInputSchema.parse(input);
      const tier = input.tier ?? VISION_DEFAULT_TIER;
      const messages: Message[] = buildVisionMessages(input);
      return runCapability({
        primary: resolveTier(tier, input.override, cfg.defaults),
        fallback: input.fallback,
        capability: "vision",
        tier,
        purpose: input.purpose,
        labels: input.labels,
        estIn: estTokens(input.prompt) + 1000, // prompt + ~1k image payload
        estOut: 512,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.vision) throw new Error(`createAI: provider "${spec.provider}" does not support vision`);
          return adapter.vision({ messages, spec });
        },
      });
    },

    async video(input: VideoInput): Promise<ChatResult> {
      input = videoInputSchema.parse(input);
      const tier = input.tier ?? VIDEO_DEFAULT_TIER;
      const messages: Message[] = buildVideoMessages(input);
      return runCapability({
        primary: resolveTier(tier, input.override, cfg.defaults),
        fallback: input.fallback,
        capability: "video",
        tier,
        purpose: input.purpose,
        labels: input.labels,
        estIn: estTokens(input.prompt) + 4000, // prompt + video tokens (native video ≈ frames)
        estOut: 512,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          // Video routes through the vision method — same multimodal message path.
          if (!adapter.vision) throw new Error(`createAI: provider "${spec.provider}" does not support video`);
          return adapter.vision({ messages, spec });
        },
      });
    },

    async translate(input: TranslateInput): Promise<TranslateResult> {
      input = translateInputSchema.parse(input);
      const tier = input.tier ?? TRANSLATE_DEFAULT_TIER;
      const messages: Message[] = buildTranslateMessages(input);
      const estIn = estTokens(input.text) + 40;
      const res = await runCapability<ChatResult>({
        primary: resolveTier(tier, input.override, cfg.defaults),
        fallback: input.fallback,
        capability: "translate",
        tier,
        purpose: input.purpose,
        labels: input.labels,
        estIn,
        estOut: estIn,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.chat) throw new Error(`createAI: provider "${spec.provider}" does not support chat (translate routes through chat)`);
          return adapter.chat({ messages, spec });
        },
      });
      return { text: res.text, usage: res.usage };
    },

    async image(input: ImageInput): Promise<ImageResult> {
      input = imageInputSchema.parse(input);
      return runCapability({
        primary: { ...DEFAULT_IMAGE_SPEC, ...input.override },
        fallback: input.fallback,
        capability: "image",
        purpose: input.purpose,
        labels: input.labels,
        estIn: 0, // image cost is not token-based
        estOut: 0,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.image) throw new Error(`createAI: provider "${spec.provider}" does not support image`);
          return adapter.image({ prompt: input.prompt, spec, width: input.width, height: input.height });
        },
      });
    },

    async embedding(input: EmbeddingInput): Promise<EmbeddingResult> {
      input = embeddingInputSchema.parse(input);
      const tier = input.tier ?? EMBEDDING_DEFAULT_TIER;
      const text = Array.isArray(input.text) ? input.text : [input.text];
      return runCapability({
        primary: resolveTier(tier, input.override, cfg.defaults),
        fallback: input.fallback,
        capability: "embedding",
        tier,
        purpose: input.purpose,
        labels: input.labels,
        estIn: text.reduce((n, t) => n + estTokens(t), 0),
        estOut: 0,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.embedding) throw new Error(`createAI: provider "${spec.provider}" does not support embedding`);
          return adapter.embedding({ input: text, spec });
        },
      });
    },

    async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
      input = transcribeInputSchema.parse(input);
      const audio = await resolveAudio(input.audio);
      return runCapability({
        primary: { ...DEFAULT_TRANSCRIBE_SPEC, ...input.override },
        fallback: input.fallback,
        capability: "transcribe",
        purpose: input.purpose,
        labels: input.labels,
        estIn: 0,
        estOut: 0,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.transcribe) throw new Error(`createAI: provider "${spec.provider}" does not support transcribe`);
          return adapter.transcribe({ audio, language: input.language, durationSec: input.durationSec, spec });
        },
      });
    },

    // Replaced below with the real prompt-contracts (needs the client itself).
    contracts: undefined as unknown as AiClient["contracts"],
  };

  client.contracts = makeContracts(client);
  return client;
}
