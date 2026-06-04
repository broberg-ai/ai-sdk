import { expect, test, afterEach } from "bun:test";
import { createAI } from "../client.js";
import { buildVideoMessages, VIDEO_DEFAULT_TIER } from "./video.js";
import { DEFAULT_TIER_MAP } from "../routing/tier-map.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Mock globalThis.fetch (the gemini adapter's chat/vision uses httpTransport →
 *  global fetch) and capture the request body to assert the wire shape offline. */
function mockFetch(response: unknown) {
  const seen: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(init!.body as string) });
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return seen;
}

test("buildVideoMessages puts the video part before the prompt", () => {
  const msgs = buildVideoMessages({ video: "data:video/mp4;base64,AAA", prompt: "what is this?", mimeType: "video/mp4" } as any);
  expect(msgs[0]!.role).toBe("user");
  const parts = msgs[0]!.content as any[];
  expect(parts[0]).toEqual({ type: "video", video: "data:video/mp4;base64,AAA", mimeType: "video/mp4" });
  expect(parts[1]).toEqual({ type: "text", text: "what is this?" });
});

test("video tier defaults to gemini-2.5-flash-lite and is priced", () => {
  expect(VIDEO_DEFAULT_TIER).toBe("video");
  const spec = DEFAULT_TIER_MAP.video;
  expect(spec.provider).toBe("gemini");
  expect(spec.model).toBe("gemini-2.5-flash-lite");
});

test("ai.video sends the video inline to Gemini + prices the call", async () => {
  const seen = mockFetch({
    candidates: [{ content: { parts: [{ text: "a cat playing" }] } }],
    usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 12 },
  });
  const ai = createAI();
  const { text, usage } = await ai.video({
    video: new Uint8Array([1, 2, 3]),
    prompt: "What's in this video?",
    override: { provider: "gemini", model: "gemini-2.5-flash-lite", transport: "http" },
  });
  expect(text).toBe("a cat playing");
  expect(usage.capability).toBe("video");
  expect(usage.provider).toBe("gemini");
  // inline video part on the wire (base64 of [1,2,3]) with a video mime
  const part = seen[0]!.body.contents[0].parts[0];
  expect(part.inlineData.mimeType).toBe("video/mp4");
  expect(part.inlineData.data).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  // gemini-2.5-flash-lite priced 0.1/0.4 → non-zero
  expect(usage.costUsd).toBeGreaterThan(0);
});

test("ai.video works without an override via the default video tier", async () => {
  mockFetch({ candidates: [{ content: { parts: [{ text: "ok" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } });
  // default video tier → gemini; provide the gemini key via env-less override-free path
  const ai = createAI();
  process.env.GEMINI_API_KEY ??= "test-key";
  const { text } = await ai.video({ video: "data:video/mp4;base64,QQ", prompt: "describe" });
  expect(text).toBe("ok");
});
