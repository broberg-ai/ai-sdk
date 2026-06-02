import { expect, test, afterEach } from "bun:test";
import { buildVisionMessages, VISION_DEFAULT_TIER } from "./vision.js";
import { createAI } from "../client.js";

const realFetch = globalThis.fetch;
const prevKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevKey;
});

function mockAnthropic() {
  process.env.ANTHROPIC_API_KEY = "sk-test"; // fetch is mocked; key just unblocks the adapter
  const seen: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(init!.body as string) });
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "a sunny beach" }],
        usage: { input_tokens: 1100, output_tokens: 6 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return seen;
}

test("buildVisionMessages produces one user message with text + image parts", () => {
  const msgs = buildVisionMessages({ image: "https://x/p.png", prompt: "what?" });
  expect(msgs).toHaveLength(1);
  expect(msgs[0]?.role).toBe("user");
  const parts = msgs[0]?.content as { type: string }[];
  expect(parts.map((p) => p.type)).toEqual(["text", "image"]);
});

test("VISION_DEFAULT_TIER is 'vision'", () => {
  expect(VISION_DEFAULT_TIER).toBe("vision");
});

test("ai.vision() with a URL image → default vision tier (anthropic), text + usage", async () => {
  const seen = mockAnthropic();
  const ai = createAI({ providers: undefined }); // default live registry → real anthropic
  const res = await ai.vision({ image: "https://x/beach.png", prompt: "describe" });
  // default vision tier resolves to anthropic claude-sonnet-4-6 over http
  expect(seen[0]?.url).toBe("https://api.anthropic.com/v1/messages");
  expect(res.text).toBe("a sunny beach");
  expect(res.usage.provider).toBe("anthropic");
  expect(res.usage.tier).toBe("vision");
  expect(res.usage.capability).toBe("vision");
  expect(res.usage.inputTokens).toBe(1100);
  // url image block sent
  const block = seen[0]?.body.messages[0].content[1];
  expect(block.source.type).toBe("url");
});

test("ai.vision() accepts raw bytes (Uint8Array → base64 image block)", async () => {
  const seen = mockAnthropic();
  const ai = createAI();
  const bytes = new Uint8Array([137, 80, 78, 71]); // PNG magic
  const res = await ai.vision({ image: bytes, prompt: "what is this", mimeType: "image/png" });
  expect(res.text).toBe("a sunny beach");
  const block = seen[0]?.body.messages[0].content[1];
  expect(block.source.type).toBe("base64");
  expect(block.source.media_type).toBe("image/png");
});

test("vision tier is overridable per call", async () => {
  mockAnthropic();
  const ai = createAI();
  const res = await ai.vision({ image: "https://x/p.png", prompt: "p", tier: "smart" });
  expect(res.usage.tier).toBe("smart");
});
