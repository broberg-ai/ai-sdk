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
