// createAI() — the facade factory. Resolves routing, picks a provider adapter,
// delegates the call, stamps call-context metadata onto Usage, and reports to the
// cost sink. Provider specifics live in adapters; cost compute/budget land in F3.
import { resolveTier } from "./routing/tier-map.js";
import { defaultProviders } from "./providers/registry.js";
import { computeCost } from "./cost/usage.js";
import { BudgetGuard } from "./cost/budget.js";
import { buildVisionMessages, VISION_DEFAULT_TIER } from "./capabilities/vision.js";
import { buildTranslateMessages, TRANSLATE_DEFAULT_TIER } from "./capabilities/translate.js";
import { EMBEDDING_DEFAULT_TIER } from "./capabilities/embedding.js";
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
  const budget = cfg.budget ? new BudgetGuard(cfg.budget) : undefined;

  const estTokens = (s: string): number => Math.ceil(s.length / 4);

  /** Pre-flight budget check. Estimates this call's cost and throws
   *  BudgetExceededError before the transport fires. No-op without a budget. */
  function preflight(spec: TierSpec, estInTokens: number, estOutTokens: number): void {
    if (!budget) return;
    budget.check(computeCost(spec.provider, spec.model, estInTokens, estOutTokens));
  }

  /** Fold the actual cost into the rolling total after a successful call. */
  function settle(usage: Usage): void {
    if (budget) budget.record(usage.costUsd);
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
      const messages = toMessages(input);
      const estIn = messages.reduce(
        (n, m) => n + estTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content)),
        0,
      );
      preflight(spec, estIn, input.maxTokens ?? 512);
      const t0 = performance.now();
      const res = await adapter.chat({
        messages,
        spec,
        tools: input.tools,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      });
      enrich(res.usage, "chat", input.tier ?? "smart", input.purpose, performance.now() - t0);
      settle(res.usage);
      await report(res.usage);
      return res;
    },

    async vision(input: VisionInput): Promise<ChatResult> {
      input = visionInputSchema.parse(input);
      const spec = resolveTier(input.tier ?? VISION_DEFAULT_TIER, input.override, cfg.defaults);
      const adapter = pickProvider(spec.provider);
      if (!adapter.vision) {
        throw new Error(`createAI: provider "${spec.provider}" does not support vision`);
      }
      const messages: Message[] = buildVisionMessages(input);
      // Rough: prompt tokens + ~1k for the image payload.
      preflight(spec, estTokens(input.prompt) + 1000, 512);
      const t0 = performance.now();
      const res = await adapter.vision({ messages, spec });
      enrich(res.usage, "vision", input.tier ?? VISION_DEFAULT_TIER, input.purpose, performance.now() - t0);
      settle(res.usage);
      await report(res.usage);
      return res;
    },

    async translate(input: TranslateInput): Promise<TranslateResult> {
      input = translateInputSchema.parse(input);
      const spec = resolveTier(input.tier ?? TRANSLATE_DEFAULT_TIER, input.override, cfg.defaults);
      const adapter = pickProvider(spec.provider);
      if (!adapter.chat) {
        throw new Error(`createAI: provider "${spec.provider}" does not support chat (translate routes through chat)`);
      }
      const messages: Message[] = buildTranslateMessages(input);
      const estIn = estTokens(input.text) + 40;
      preflight(spec, estIn, estIn);
      const t0 = performance.now();
      const res = await adapter.chat({ messages, spec });
      enrich(res.usage, "translate", input.tier ?? TRANSLATE_DEFAULT_TIER, input.purpose, performance.now() - t0);
      settle(res.usage);
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
      // Image cost is not token-based; pre-flight estimates 0 (only a per-call
      // ceiling of 0 would block). Actual cost is folded in post-call.
      preflight(spec, 0, 0);
      const t0 = performance.now();
      const res = await adapter.image({
        prompt: input.prompt,
        spec,
        width: input.width,
        height: input.height,
      });
      enrich(res.usage, "image", undefined, input.purpose, performance.now() - t0);
      settle(res.usage);
      await report(res.usage);
      return res;
    },

    async embedding(input: EmbeddingInput): Promise<EmbeddingResult> {
      input = embeddingInputSchema.parse(input);
      const spec = resolveTier(input.tier ?? EMBEDDING_DEFAULT_TIER, input.override, cfg.defaults);
      const adapter = pickProvider(spec.provider);
      if (!adapter.embedding) {
        throw new Error(`createAI: provider "${spec.provider}" does not support embedding`);
      }
      const text = Array.isArray(input.text) ? input.text : [input.text];
      preflight(spec, text.reduce((n, t) => n + estTokens(t), 0), 0);
      const t0 = performance.now();
      const res = await adapter.embedding({ input: text, spec });
      enrich(res.usage, "embedding", input.tier ?? EMBEDDING_DEFAULT_TIER, input.purpose, performance.now() - t0);
      settle(res.usage);
      await report(res.usage);
      return res;
    },
  };
}
