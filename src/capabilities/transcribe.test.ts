import { expect, test, afterEach } from "bun:test";
import { resolveAudio, DEFAULT_TRANSCRIBE_SPEC } from "./transcribe.js";
import { openaiAdapter } from "../providers/openai.js";
import { createAI } from "../client.js";

const realFetch = globalThis.fetch;
const prevKey = process.env.OPENAI_API_KEY;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
});

test("DEFAULT_TRANSCRIBE_SPEC = openai/whisper-1", () => {
  expect(DEFAULT_TRANSCRIBE_SPEC).toEqual({ provider: "openai", model: "whisper-1", transport: "http" });
});

test("resolveAudio: bytes pass through, URL is fetched, non-url string throws", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  expect(await resolveAudio(bytes)).toBe(bytes);

  const fetchImpl = (async () => new Response(new Uint8Array([9, 9]).buffer, { status: 200 })) as unknown as typeof fetch;
  const fetched = await resolveAudio("https://x/a.mp3", fetchImpl);
  expect(Array.from(fetched)).toEqual([9, 9]);

  await expect(resolveAudio("not-a-url")).rejects.toThrow(/http\(s\) URL/);
});

test("openai adapter transcribe(): POSTs whisper multipart, returns text + usage", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  const seen: { url: string }[] = [];
  globalThis.fetch = (async (url: string) => {
    seen.push({ url: String(url) });
    return new Response(JSON.stringify({ text: "hej med dig" }), { status: 200 });
  }) as unknown as typeof fetch;
  const a = openaiAdapter({ apiKey: "k" });
  const res = await a.transcribe!({
    audio: new Uint8Array([1, 2, 3]),
    spec: { provider: "openai", model: "whisper-1", transport: "http" },
  });
  expect(seen[0]?.url).toBe("https://api.openai.com/v1/audio/transcriptions");
  expect(res.text).toBe("hej med dig");
  expect(res.usage.provider).toBe("openai");
  expect(res.usage.capability).toBe("transcribe");
});

test("ai.transcribe({audio: bytes}) → text via default openai/whisper", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  globalThis.fetch = (async () => new Response(JSON.stringify({ text: "transcript" }), { status: 200 })) as unknown as typeof fetch;
  const ai = createAI();
  const res = await ai.transcribe({ audio: new Uint8Array([1, 2, 3]) });
  expect(res.text).toBe("transcript");
  expect(res.usage.capability).toBe("transcribe");
});

test("durationSec → Whisper per-minute cost (120s ≈ $0.012); without it → 0", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  globalThis.fetch = (async () => new Response(JSON.stringify({ text: "t" }), { status: 200 })) as unknown as typeof fetch;
  const ai = createAI();
  const withDur = await ai.transcribe({ audio: new Uint8Array([1]), durationSec: 120 });
  expect(withDur.usage.costUsd).toBeCloseTo(0.012, 6);
  const without = await ai.transcribe({ audio: new Uint8Array([1]) });
  expect(without.usage.costUsd).toBe(0);
});

// F036 — opt-in timestamps.
test("transcribe timestamps ['word','segment']: verbose_json + granularities sent, both parsed", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  let form: FormData | undefined;
  globalThis.fetch = (async (_url: string, init: { body: FormData }) => {
    form = init.body;
    return new Response(
      JSON.stringify({
        text: "hej med dig",
        words: [
          { word: "hej", start: 0, end: 0.4 },
          { word: "med", start: 0.4, end: 0.7 },
        ],
        segments: [{ text: "hej med dig", start: 0, end: 1.2 }],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const res = await createAI().transcribe({ audio: new Uint8Array([1, 2, 3]), timestamps: ["word", "segment"] });
  expect(form?.get("response_format")).toBe("verbose_json");
  expect(form?.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]);
  expect(res.words).toEqual([
    { word: "hej", start: 0, end: 0.4 },
    { word: "med", start: 0.4, end: 0.7 },
  ]);
  expect(res.segments).toEqual([{ text: "hej med dig", start: 0, end: 1.2 }]);
});

test("transcribe timestamps 'segment' (single): segments filled, words NOT surfaced", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  let form: FormData | undefined;
  globalThis.fetch = (async (_url: string, init: { body: FormData }) => {
    form = init.body;
    // API may still include words; caller asked only for "segment" → don't surface them.
    return new Response(
      JSON.stringify({ text: "en sætning", words: [{ word: "en", start: 0, end: 0.2 }], segments: [{ text: "en sætning", start: 0, end: 0.9 }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const res = await createAI().transcribe({ audio: new Uint8Array([1]), timestamps: "segment" });
  expect(form?.getAll("timestamp_granularities[]")).toEqual(["segment"]);
  expect(res.segments).toHaveLength(1);
  expect(res.words).toBeUndefined();
});

test("transcribe without timestamps: no response_format, plain {text} — backward-compat", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  let form: FormData | undefined;
  globalThis.fetch = (async (_url: string, init: { body: FormData }) => {
    form = init.body;
    return new Response(JSON.stringify({ text: "plain" }), { status: 200 });
  }) as unknown as typeof fetch;
  const res = await createAI().transcribe({ audio: new Uint8Array([1]) });
  expect(form?.get("response_format")).toBeNull();
  expect(res.text).toBe("plain");
  expect(res.words).toBeUndefined();
  expect(res.segments).toBeUndefined();
});

test("ai.transcribe({audio: URL}) fetches the URL then transcribes", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    if (String(url).endsWith(".mp3")) return new Response(new Uint8Array([5, 5]).buffer, { status: 200 });
    return new Response(JSON.stringify({ text: "from url" }), { status: 200 });
  }) as unknown as typeof fetch;
  const ai = createAI();
  const res = await ai.transcribe({ audio: "https://x/clip.mp3", language: "da" });
  expect(res.text).toBe("from url");
  expect(urls).toContain("https://x/clip.mp3");
  expect(urls).toContain("https://api.openai.com/v1/audio/transcriptions");
});
