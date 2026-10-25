import { expect, test } from "bun:test";
import { mistralAdapter, MISTRAL_TTS_DEFAULT_MODEL } from "./mistral.js";
import { createAI } from "../client.js";

const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 250]);

function speechFetch() {
  const seen: { url: string; body: any; auth: string | null }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(String(init!.body)), auth: new Headers(init!.headers).get("authorization") });
    return new Response(JSON.stringify({ audio_data: Buffer.from(AUDIO).toString("base64") }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { f, seen };
}

// What ai.tts hands the adapter when the caller overrides only the provider: the
// default route's model (ElevenLabs'), because tts merges without a model.
const spec = { provider: "mistral", model: "eleven_multilingual_v2", transport: "http" as const };

test("tts posts model/input/voice_id/response_format and decodes the base64 audio (F083)", async () => {
  const { f, seen } = speechFetch();
  const r = await mistralAdapter({ apiKey: "k", fetch: f }).tts!({ text: "Hej", voiceId: "voice_481", spec });
  expect(seen[0]!.url).toBe("https://api.mistral.ai/v1/audio/speech");
  expect(seen[0]!.auth).toBe("Bearer k");
  expect(seen[0]!.body).toEqual({ model: MISTRAL_TTS_DEFAULT_MODEL, input: "Hej", voice_id: "voice_481", response_format: "mp3" });
  expect(Array.from(r.audio)).toEqual(Array.from(AUDIO));
  expect(r.mimeType).toBe("audio/mpeg");
  expect(r.usage.model).toBe("voxtral-mini-tts-3-0");
  expect(r.usage.region).toBe("eu");
  expect(r.usage.capability).toBe("tts");
});

test("an explicit Voxtral TTS model is sent as given; format drives the mime type (F083)", async () => {
  const { f, seen } = speechFetch();
  const r = await mistralAdapter({ apiKey: "k", fetch: f }).tts!({
    text: "Hej", voiceId: "voice_481", format: "wav", spec: { ...spec, model: "voxtral-mini-tts-3" },
  });
  expect(seen[0]!.body.model).toBe("voxtral-mini-tts-3");
  expect(seen[0]!.body.response_format).toBe("wav");
  expect(r.mimeType).toBe("audio/wav");
});

test("billed per character at $13/M for the default model (F083)", async () => {
  const { f } = speechFetch();
  const r = await mistralAdapter({ apiKey: "k", fetch: f }).tts!({ text: "x".repeat(1000), voiceId: "voice_481", spec });
  expect(r.usage.costUsd).toBeCloseTo(0.013, 9);
  expect(r.usage.costBasis).toBe("computed");
});

test("a Voxtral TTS model with no price row books $0 as unpriced, never a guess (F083)", async () => {
  const { f } = speechFetch();
  const r = await mistralAdapter({ apiKey: "k", fetch: f }).tts!({ text: "Hej", voiceId: "voice_481", spec: { ...spec, model: "voxtral-mini-tts-9" } });
  expect(r.usage.costUsd).toBe(0);
  expect(r.usage.costBasis).toBe("unpriced");
});

test("an alias pronunciation rewrites the input (F083)", async () => {
  const { f, seen } = speechFetch();
  await mistralAdapter({ apiKey: "k", fetch: f }).tts!({
    text: "Vi bruger AI hver dag", voiceId: "voice_481", pronunciations: [{ word: "AI", alias: "ei-ai" }], spec,
  });
  expect(seen[0]!.body.input).toBe("Vi bruger ei-ai hver dag");
});

test("ipa, an unknown format and wordTimings throw and name the alternative — never silently ignored (F083)", async () => {
  const { f, seen } = speechFetch();
  const a = mistralAdapter({ apiKey: "k", fetch: f });
  await expect(a.tts!({ text: "x", voiceId: "v", pronunciations: [{ word: "AI", ipa: "eɪ aɪ" }], spec })).rejects.toThrow(/alias.*azure/);
  await expect(a.tts!({ text: "x", voiceId: "v", format: "aac", spec })).rejects.toThrow(/mp3, wav, pcm, flac, opus/);
  await expect(a.tts!({ text: "x", voiceId: "v", wordTimings: true, spec })).rejects.toThrow(/azure/);
  expect(seen.length).toBe(0);
});

test("ai.tts with override:{provider:'mistral'} reaches the Voxtral route (F083)", async () => {
  const { f, seen } = speechFetch();
  const ai = createAI({ providers: { mistral: mistralAdapter({ apiKey: "k", fetch: f }) } });
  const r = await ai.tts({ text: "Hej", voice: "voice_481", override: { provider: "mistral" } });
  expect(seen[0]!.body.voice_id).toBe("voice_481");
  expect(r.usage.provider).toBe("mistral");
  expect(r.usage.model).toBe("voxtral-mini-tts-3-0");
});
