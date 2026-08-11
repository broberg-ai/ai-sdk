// F037.3 — ai.tts / ai.podcast refuse a voice we know is dead, instead of shipping
// it to the provider. The assertions check the ADAPTER WAS NEVER CALLED, not merely
// that something threw: a throw from inside the call path would still have burned a
// request, and that is the failure mode this story exists to prevent.
import { describe, expect, test } from "bun:test";
import { createAI } from "../client.js";
import { VoiceUnavailableError } from "./index.js";
import { freshUsage } from "../cost/usage.js";
import type { ProviderAdapter, TtsRequest, DialogueRequest, PodcastResult } from "../types.js";

const DEAD = "mads";

/** A recording ElevenLabs stand-in — every tts/dialogue call lands in `calls`. */
function spyProvider() {
  const calls: { voiceIds: string[] }[] = [];
  const result = (): PodcastResult => ({
    audio: new Uint8Array([1, 2, 3]),
    mimeType: "audio/mpeg",
    usage: freshUsage({
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      transport: "http",
      capability: "tts",
      inputTokens: 0,
      outputTokens: 0,
    }),
  });
  const adapter: ProviderAdapter = {
    name: "elevenlabs",
    async tts(req: TtsRequest) {
      calls.push({ voiceIds: [req.voiceId] });
      return result();
    },
    async dialogue(req: DialogueRequest) {
      calls.push({ voiceIds: req.inputs.map((i) => i.voiceId) });
      return result();
    },
  };
  return { calls, providers: { elevenlabs: adapter, azure: adapter } };
}

describe("ai.tts refuses a retired voice", () => {
  test("throws VoiceUnavailableError AND never calls the provider", async () => {
    const { calls, providers } = spyProvider();
    const ai = createAI({ providers, costSink: null });

    let caught: unknown;
    try {
      await ai.tts({ text: "hej", voice: DEAD });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(VoiceUnavailableError);
    expect((caught as VoiceUnavailableError).code).toBe("voice_unavailable");
    // The load-bearing assertion: zero requests were made.
    expect(calls).toHaveLength(0);
  });

  test("voiceFallback sends the fallback's id, exactly once", async () => {
    const { calls, providers } = spyProvider();
    const ai = createAI({ providers, costSink: null });

    const res = await ai.tts({ text: "hej", voice: DEAD, voiceFallback: "soren" });

    expect(res.mimeType).toBe("audio/mpeg");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.voiceIds).toEqual(["xj6X4BCUsv9oxohm1E8o"]);
  });
});

describe("UNCHANGED PATHS — the blast radius is only voices we mark retired", () => {
  test("a live curated Azure name still reaches the adapter as its full voice id", async () => {
    const { calls, providers } = spyProvider();
    const ai = createAI({ providers, costSink: null });

    await ai.tts({ text: "hej", voice: "christel", override: { provider: "azure" } });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.voiceIds).toEqual(["da-DK-ChristelNeural"]);
  });

  test("a live curated ElevenLabs name still maps to its voice id", async () => {
    const { calls, providers } = spyProvider();
    const ai = createAI({ providers, costSink: null });

    await ai.tts({ text: "hej", voice: "camilla" });

    expect(calls[0]?.voiceIds).toEqual(["4RklGmuxoAskAbGXplXN"]);
  });

  test("an untracked raw provider id still passes through verbatim", async () => {
    const { calls, providers } = spyProvider();
    const ai = createAI({ providers, costSink: null });

    await ai.tts({ text: "hej", voice: "21m00Tcm4TlvDq8ikWAM" });

    expect(calls[0]?.voiceIds).toEqual(["21m00Tcm4TlvDq8ikWAM"]);
  });
});

describe("ai.podcast refuses a retired voice in the cast", () => {
  test("names the speaker and never calls the provider", async () => {
    const { calls, providers } = spyProvider();
    const ai = createAI({ providers, costSink: null });

    let caught: unknown;
    try {
      await ai.podcast({
        script: [
          { speaker: "vært", text: "Velkommen." },
          { speaker: "gæst", text: "Tak." },
        ],
        voices: { "vært": "soren", "gæst": DEAD },
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(VoiceUnavailableError);
    // Which speaker is the part a caller needs to fix the manuscript.
    expect((caught as Error).message).toContain("gæst");
    expect(calls).toHaveLength(0);
  });

  test("a cast of live voices still reaches the adapter unchanged", async () => {
    const { calls, providers } = spyProvider();
    const ai = createAI({ providers, costSink: null });

    await ai.podcast({
      script: [
        { speaker: "vært", text: "Velkommen." },
        { speaker: "gæst", text: "Tak." },
      ],
      voices: { "vært": "soren", "gæst": "camilla" },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.voiceIds).toEqual(["xj6X4BCUsv9oxohm1E8o", "4RklGmuxoAskAbGXplXN"]);
  });

  test("a dialogue does NOT fall back — two speakers must not collapse onto one voice", async () => {
    const { calls, providers } = spyProvider();
    const ai = createAI({ providers, costSink: null });

    // Even though `soren` is alive and available, podcast refuses rather than
    // silently making both speakers sound identical.
    await expect(
      ai.podcast({
        script: [{ speaker: "a", text: "x" }],
        voices: { a: DEAD },
      }),
    ).rejects.toThrow(VoiceUnavailableError);
    expect(calls).toHaveLength(0);
  });
});
