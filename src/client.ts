// createAI() — the facade factory. Resolves routing, picks a provider adapter,
// delegates the call, stamps call-context metadata onto Usage, and reports to the
// cost sink. Provider specifics live in adapters; cost compute/budget land in F3.
import { resolveTier } from "./routing/tier-map.js";
import { resolveModel } from "./availability/resolve.js";
import { defaultProviders } from "./providers/registry.js";
import { computeCost } from "./cost/usage.js";
import { BudgetGuard } from "./cost/budget.js";
import { buildVisionMessages, VISION_DEFAULT_TIER } from "./capabilities/vision.js";
import { buildVideoMessages, VIDEO_DEFAULT_TIER } from "./capabilities/video.js";
import { buildTranslateMessages, TRANSLATE_DEFAULT_TIER } from "./capabilities/translate.js";
import { EMBEDDING_DEFAULT_TIER } from "./capabilities/embedding.js";
import { DEFAULT_TRANSCRIBE_SPEC, resolveAudio } from "./capabilities/transcribe.js";
import { makeContracts } from "./capabilities/contracts/index.js";
import { resolveVoice } from "./providers/elevenlabs.js";
import {
  aiConfigSchema,
  chatInputSchema,
  visionInputSchema,
  videoInputSchema,
  translateInputSchema,
  imageInputSchema,
  animateInputSchema,
  trainStyleInputSchema,
  embeddingInputSchema,
  transcribeInputSchema,
  ocrInputSchema,
  moderationInputSchema,
  podcastInputSchema,
  ttsInputSchema,
} from "./schema/inputs.js";
import type {
  AiConfig,
  AiClient,
  ChatInput,
  VisionInput,
  VideoInput,
  TranslateInput,
  ImageInput,
  AnimateInput,
  TrainStyleInput,
  EmbeddingInput,
  TranscribeInput,
  OcrInput,
  ModerationInput,
  PodcastInput,
  TtsInput,
} from "./schema/inputs.js";
import type {
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
/** LoRA-inference route (F021) — used by ai.image when loras are supplied. */
const DEFAULT_LORA_IMAGE_SPEC: TierSpec = {
  provider: "fal",
  model: "fal-ai/flux-lora",
  transport: "http",
};
/** Style-LoRA training route (F021) — fal flux-lora-fast-training. */
const DEFAULT_TRAINSTYLE_SPEC: TierSpec = {
  provider: "fal",
  model: "fal-ai/flux-lora-fast-training",
  transport: "http",
};
/** Image-to-video route (F024) — Veo 3.1 DIRECT via the Gemini API (no fal markup,
 *  our existing GEMINI_API_KEY, and the path to EU via Vertex later). Override to
 *  {provider:"fal", model:"fal-ai/veo3.1/..."} for the aggregator / other models
 *  (Kling, Seedance). US-hosted: consent-gated use (F024). */
const DEFAULT_ANIMATE_SPEC: TierSpec = {
  provider: "gemini",
  model: "veo-3.1-generate-preview",
  transport: "http",
};
/** Default audio directive appended to every ai.animate prompt (F024, Christian's
 *  preference): no generated speech (it's the weak link, esp. non-English), but
 *  ambient sounds matched to the scene are wanted. A soft prompt instruction. */
const ANIMATE_AUDIO_DIRECTIVE =
  "No spoken dialogue, no talking, no voiceover. Include natural ambient background sounds that match the environment.";
/** EU-resident finetuned-portrait route (F023) — BFL, used by ai.image when a
 *  `finetune` id is supplied. Hard-pinned to api.eu.bfl.ai inside the adapter. */
const DEFAULT_BFL_FINETUNE_SPEC: TierSpec = {
  provider: "bfl",
  model: "flux-pro-1.1-ultra-finetuned",
  transport: "http",
};
/** EU-resident multi-reference route (F023.5) — BFL FLUX 2, used by ai.image when
 *  `referenceImages` are supplied (likeness with no training step). flux-2-max =
 *  premium-quality default; override to flux-2-pro/flex for volume. EU-pinned. */
const DEFAULT_BFL_REFERENCE_SPEC: TierSpec = {
  provider: "bfl",
  model: "flux-2-max",
  transport: "http",
};

/** OCR + moderation are Mistral specialty endpoints (F016) — no tier, route by default. */
const DEFAULT_OCR_SPEC: TierSpec = { provider: "mistral", model: "mistral-ocr-latest", transport: "http" };
const DEFAULT_MODERATION_SPEC: TierSpec = { provider: "mistral", model: "mistral-moderation-latest", transport: "http" };
/** Podcast route (F020) — ElevenLabs Text-to-Dialogue, eleven_v3 (multi-voice, multilingual). */
const DEFAULT_PODCAST_SPEC: TierSpec = { provider: "elevenlabs", model: "eleven_v3", transport: "http" };
/** Single-voice TTS route (F020.4) — ElevenLabs eleven_multilingual_v2 (good Danish). */
const DEFAULT_TTS_SPEC: TierSpec = { provider: "elevenlabs", model: "eleven_multilingual_v2", transport: "http" };
/** Batch route (F016.1) — Mistral batch jobs (50% cost), cheap default model. */
const DEFAULT_BATCH_SPEC: TierSpec = { provider: "mistral", model: "mistral-small-latest", transport: "http" };

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
    if (input.messages && input.messages.length > 0) {
      // A top-level `system` must survive when `messages` is also supplied — prepend
      // it (unless the caller already leads with a system message) instead of
      // silently dropping it. Regression: system + messages → system was lost, so a
      // "return ONLY JSON" system instruction never reached the model (cms #4234).
      if (input.system && input.messages[0]?.role !== "system") {
        return [{ role: "system", content: input.system }, ...input.messages];
      }
      return input.messages;
    }
    const msgs: Message[] = [];
    if (input.system) msgs.push({ role: "system", content: input.system });
    msgs.push({ role: "user", content: input.prompt ?? "" });
    return msgs;
  }

  /** F022 — opt-in proactive availability gate. When cfg.availability.autoResolve
   *  is set, swap a known-suspended primary model to its configured fallback
   *  BEFORE dispatch (synchronous, registry-only — no I/O). Default off → the
   *  spec is returned untouched and behaviour is byte-identical. This sits in
   *  front of the reactive route-fallback below. */
  function applyAvailability(spec: TierSpec): TierSpec {
    if (!cfg.availability?.autoResolve) return spec;
    const r = resolveModel(spec.model, { fallback: cfg.availability.fallback, provider: spec.provider });
    return r.fellBack ? { ...spec, model: r.model } : spec;
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
      applyAvailability(opts.primary),
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
      const res = await runCapability<TranslateResult>({
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
          // A dedicated translation engine (F032, e.g. DeepL) is preferred when the
          // resolved provider implements it — its `to`/`from` are provider-specific
          // codes, not the free-form names the chat prompt-contract accepts.
          if (adapter.translate) return adapter.translate({ text: input.text, to: input.to, from: input.from, spec });
          if (!adapter.chat) throw new Error(`createAI: provider "${spec.provider}" does not support chat (translate routes through chat)`);
          return adapter.chat({ messages, spec });
        },
      });
      return { text: res.text, usage: res.usage };
    },

    async image(input: ImageInput): Promise<ImageResult> {
      input = imageInputSchema.parse(input);
      // Normalize the `lora` shorthand into the loras array.
      const loras = [
        ...(input.loras ?? []),
        ...(input.lora ? [{ path: input.lora }] : []),
      ];
      // Route by what's supplied (override still wins): `referenceImages` → the EU
      // BFL FLUX 2 multi-reference endpoint (F023.5, no training step); a `finetune`
      // id → the EU BFL finetuned-portrait endpoint (F023); LoRAs → flux-lora (F021,
      // flux/schnell can't merge LoRAs); else the plain image route.
      const base = input.referenceImages?.length
        ? DEFAULT_BFL_REFERENCE_SPEC
        : input.finetune
          ? DEFAULT_BFL_FINETUNE_SPEC
          : loras.length > 0
            ? DEFAULT_LORA_IMAGE_SPEC
            : DEFAULT_IMAGE_SPEC;
      return runCapability({
        primary: { ...base, ...input.override },
        fallback: input.fallback,
        capability: "image",
        purpose: input.purpose,
        labels: input.labels,
        estIn: 0, // image cost is not token-based
        estOut: 0,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.image) throw new Error(`createAI: provider "${spec.provider}" does not support image`);
          return adapter.image({
            prompt: input.prompt,
            spec,
            width: input.width,
            height: input.height,
            loras: loras.length ? loras : undefined,
            finetune: input.finetune,
            finetuneStrength: input.finetuneStrength,
            referenceImages: input.referenceImages,
            seed: input.seed,
            outputFormat: input.outputFormat,
            safetyTolerance: input.safetyTolerance,
            retryOnBlack: input.retryOnBlack,
          });
        },
      });
    },

    async animate(input: AnimateInput): Promise<AnimateResult> {
      input = animateInputSchema.parse(input);
      // Append the default audio directive (no speech, ambient sounds matched to scene).
      const prompt = input.prompt?.trim()
        ? `${input.prompt.trim()} ${ANIMATE_AUDIO_DIRECTIVE}`
        : ANIMATE_AUDIO_DIRECTIVE;
      return runCapability({
        primary: { ...DEFAULT_ANIMATE_SPEC, ...input.override },
        fallback: input.fallback,
        capability: "animate",
        purpose: input.purpose,
        labels: input.labels,
        estIn: 0, // video cost is per-second, not token-based
        estOut: 0,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.animate) throw new Error(`createAI: provider "${spec.provider}" does not support animate`);
          return adapter.animate({
            image: input.image,
            prompt,
            durationSec: input.durationSec,
            resolution: input.resolution,
            spec,
          });
        },
      });
    },

    async trainStyle(input: TrainStyleInput): Promise<TrainStyleResult> {
      input = trainStyleInputSchema.parse(input);
      return runCapability({
        primary: { ...DEFAULT_TRAINSTYLE_SPEC, ...input.override },
        fallback: input.fallback,
        capability: "trainStyle",
        purpose: input.purpose,
        labels: input.labels,
        estIn: 0, // training is priced flat by fal, not token-based
        estOut: 0,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.trainStyle)
            throw new Error(`createAI: provider "${spec.provider}" does not support trainStyle`);
          return adapter.trainStyle({
            images: input.images,
            spec,
            isStyle: input.isStyle,
            triggerWord: input.triggerWord,
            steps: input.steps,
            createMasks: input.createMasks,
          });
        },
      });
    },

    async ocr(input: OcrInput): Promise<OcrResult> {
      input = ocrInputSchema.parse(input);
      return runCapability({
        primary: { ...DEFAULT_OCR_SPEC, ...input.override },
        fallback: input.fallback,
        capability: "ocr",
        purpose: input.purpose,
        labels: input.labels,
        estIn: 0, // OCR cost is per-page, not token-based
        estOut: 0,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.ocr) throw new Error(`createAI: provider "${spec.provider}" does not support ocr`);
          return adapter.ocr({ document: input.document, mimeType: input.mimeType, spec });
        },
      });
    },

    async moderate(input: ModerationInput): Promise<ModerationResult> {
      input = moderationInputSchema.parse(input);
      const items = Array.isArray(input.input) ? input.input : [input.input];
      return runCapability({
        primary: { ...DEFAULT_MODERATION_SPEC, ...input.override },
        fallback: input.fallback,
        capability: "moderation",
        purpose: input.purpose,
        labels: input.labels,
        estIn: items.reduce((n, s) => n + estTokens(s), 0),
        estOut: 0,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.moderate) throw new Error(`createAI: provider "${spec.provider}" does not support moderation`);
          return adapter.moderate({ input: items, spec });
        },
      });
    },

    async podcast(input: PodcastInput): Promise<PodcastResult> {
      input = podcastInputSchema.parse(input);
      // Map each manuscript turn to a {text, voiceId} dialogue input.
      const inputs = input.script.map((turn) => {
        const mapped = input.voices[turn.speaker];
        if (!mapped) throw new Error(`ai.podcast: no voice mapped for speaker "${turn.speaker}"`);
        return { text: turn.text, voiceId: resolveVoice(mapped) }; // curated name → voiceId
      });
      const chars = input.script.reduce((n, t) => n + t.text.length, 0);
      return runCapability({
        primary: { ...DEFAULT_PODCAST_SPEC, ...input.override },
        fallback: input.fallback,
        capability: "podcast",
        purpose: input.purpose,
        labels: input.labels,
        estIn: chars, // per-character cost (not token-based)
        estOut: 0,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.dialogue) throw new Error(`createAI: provider "${spec.provider}" does not support podcast/dialogue`);
          return adapter.dialogue({ inputs, format: input.format, spec });
        },
      });
    },

    async tts(input: TtsInput): Promise<PodcastResult> {
      input = ttsInputSchema.parse(input);
      return runCapability({
        primary: { ...DEFAULT_TTS_SPEC, ...input.override },
        fallback: input.fallback,
        capability: "tts",
        purpose: input.purpose,
        labels: input.labels,
        estIn: input.text.length, // per-character cost
        estOut: 0,
        invoke: async (spec) => {
          const adapter = pickProvider(spec.provider);
          if (!adapter.tts) throw new Error(`createAI: provider "${spec.provider}" does not support tts`);
          return adapter.tts({ text: input.text, voiceId: resolveVoice(input.voice), lang: input.lang, format: input.format, rate: input.rate, spec });
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
          return adapter.transcribe({ audio, language: input.language, durationSec: input.durationSec, phrases: input.phrases, spec });
        },
      });
    },

    batch: {
      async submit(input: { requests: BatchRequestItem[]; override?: TierSpec }): Promise<BatchJob> {
        const spec = { ...DEFAULT_BATCH_SPEC, ...input.override };
        const adapter = pickProvider(spec.provider);
        if (!adapter.batchSubmit) throw new Error(`createAI: provider "${spec.provider}" does not support batch`);
        return adapter.batchSubmit({ items: input.requests, spec });
      },
      async status(jobId: string, override?: TierSpec): Promise<BatchJob> {
        const spec = { ...DEFAULT_BATCH_SPEC, ...override };
        const adapter = pickProvider(spec.provider);
        if (!adapter.batchStatus) throw new Error(`createAI: provider "${spec.provider}" does not support batch`);
        return adapter.batchStatus({ jobId, spec });
      },
      async results(jobId: string, override?: TierSpec): Promise<BatchResultItem[]> {
        const spec = { ...DEFAULT_BATCH_SPEC, ...override };
        const adapter = pickProvider(spec.provider);
        if (!adapter.batchResults) throw new Error(`createAI: provider "${spec.provider}" does not support batch`);
        return adapter.batchResults({ jobId, spec });
      },
    },

    // Replaced below with the real prompt-contracts (needs the client itself).
    contracts: undefined as unknown as AiClient["contracts"],
  };

  client.contracts = makeContracts(client);
  return client;
}
