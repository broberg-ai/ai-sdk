// createAI() — the facade factory. Resolves routing, picks a provider adapter,
// delegates the call, stamps call-context metadata onto Usage, and reports to the
// cost sink. Provider specifics live in adapters; cost compute/budget land in F3.
import { resolveTier } from "./routing/tier-map.js";
import { defaultProviders } from "./providers/stub.js";
import {
  aiConfigSchema,
  chatInputSchema,
  visionInputSchema,
  translateInputSchema,
  imageInputSchema,
  embeddingInputSchema,
} from "./schema/inputs.js";
import type {
  AiConfig,
  AiClient,
  ChatInput,
  VisionInput,
  TranslateInput,
  ImageInput,
  EmbeddingInput,
} from "./schema/inputs.js";
import type {
  ChatResult,
  ImageResult,
  EmbeddingResult,
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
  ): Usage {
    usage.capability = capability;
    if (tier) usage.tier = tier;
    if (purpose) usage.purpose = purpose;
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

  return {
    async chat(input: ChatInput): Promise<ChatResult> {
      input = chatInputSchema.parse(input);
      const spec = resolveTier(input.tier ?? "smart", input.override, cfg.defaults);
      const adapter = pickProvider(spec.provider);
      if (!adapter.chat) {
        throw new Error(`createAI: provider "${spec.provider}" does not support chat`);
      }
      const t0 = performance.now();
      const res = await adapter.chat({
        messages: toMessages(input),
        spec,
        tools: input.tools,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      });
      enrich(res.usage, "chat", input.tier ?? "smart", input.purpose, performance.now() - t0);
      await report(res.usage);
      return res;
    },

    async vision(input: VisionInput): Promise<ChatResult> {
      input = visionInputSchema.parse(input);
      const spec = resolveTier(input.tier ?? "vision", input.override, cfg.defaults);
      const adapter = pickProvider(spec.provider);
      if (!adapter.vision) {
        throw new Error(`createAI: provider "${spec.provider}" does not support vision`);
      }
      const messages: Message[] = [
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            { type: "image", image: input.image, mimeType: input.mimeType },
          ],
        },
      ];
      const t0 = performance.now();
      const res = await adapter.vision({ messages, spec });
      enrich(res.usage, "vision", input.tier ?? "vision", input.purpose, performance.now() - t0);
      await report(res.usage);
      return res;
    },

    async translate(input: TranslateInput): Promise<TranslateResult> {
      input = translateInputSchema.parse(input);
      const spec = resolveTier(input.tier ?? "fast", input.override, cfg.defaults);
      const adapter = pickProvider(spec.provider);
      if (!adapter.chat) {
        throw new Error(`createAI: provider "${spec.provider}" does not support chat (translate routes through chat)`);
      }
      const fromClause = input.from ? ` from ${input.from}` : "";
      const messages: Message[] = [
        {
          role: "system",
          content:
            "You are a translation engine. Translate the user's text only. " +
            "Return the translation and nothing else — no preamble, no quotes.",
        },
        { role: "user", content: `Translate${fromClause} to ${input.to}:\n\n${input.text}` },
      ];
      const t0 = performance.now();
      const res = await adapter.chat({ messages, spec });
      enrich(res.usage, "translate", input.tier ?? "fast", input.purpose, performance.now() - t0);
      await report(res.usage);
      return { text: res.text, usage: res.usage };
    },

    async image(input: ImageInput): Promise<ImageResult> {
      input = imageInputSchema.parse(input);
      const spec: TierSpec = { ...DEFAULT_IMAGE_SPEC, ...input.override };
      const adapter = pickProvider(spec.provider);
      if (!adapter.image) {
        throw new Error(`createAI: provider "${spec.provider}" does not support image`);
      }
      const t0 = performance.now();
      const res = await adapter.image({
        prompt: input.prompt,
        spec,
        width: input.width,
        height: input.height,
      });
      enrich(res.usage, "image", undefined, input.purpose, performance.now() - t0);
      await report(res.usage);
      return res;
    },

    async embedding(input: EmbeddingInput): Promise<EmbeddingResult> {
      input = embeddingInputSchema.parse(input);
      const spec = resolveTier(input.tier ?? "embedding", input.override, cfg.defaults);
      const adapter = pickProvider(spec.provider);
      if (!adapter.embedding) {
        throw new Error(`createAI: provider "${spec.provider}" does not support embedding`);
      }
      const text = Array.isArray(input.text) ? input.text : [input.text];
      const t0 = performance.now();
      const res = await adapter.embedding({ input: text, spec });
      enrich(res.usage, "embedding", input.tier ?? "embedding", input.purpose, performance.now() - t0);
      await report(res.usage);
      return res;
    },
  };
}
