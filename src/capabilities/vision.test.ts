import { expect, test, afterEach } from "bun:test";
import { buildVisionMessages, VISION_DEFAULT_TIER } from "./vision.js";
import { createAI } from "../client.js";

const realFetch = globalThis.fetch;
const prevKey = process.env.MISTRAL_API_KEY;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (prevKey === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = prevKey;
});

// F030: the default `vision` tier now resolves to Mistral (EU), not Anthropic.
// Mistral is OpenAI-compatible, so the wire is api.mistral.ai + OpenAI message/response
// shape. (Anthropic's vision wire format stays covered in anthropic.test.ts.)
function mockMistral() {
  process.env.MISTRAL_API_KEY = "k"; // fetch is mocked; key just unblocks the adapter
  const seen: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(init!.body as string) });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "a sunny beach" } }],
        usage: { prompt_tokens: 1100, completion_tokens: 6 },
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

test("buildVisionMessages prepends a system message when `system` is set (cms #4423)", () => {
  const msgs = buildVisionMessages({ image: "https://x/p.png", prompt: "what?", system: "Return ONLY JSON." });
  expect(msgs).toHaveLength(2);
  expect(msgs[0]).toEqual({ role: "system", content: "Return ONLY JSON." });
  expect(msgs[1]?.role).toBe("user");
});

test("VISION_DEFAULT_TIER is 'vision'", () => {
  expect(VISION_DEFAULT_TIER).toBe("vision");
});

test("ai.vision() with a URL image → default vision tier (mistral EU), text + usage", async () => {
  const seen = mockMistral();
  const ai = createAI({ providers: undefined }); // default live registry → real mistral
  const res = await ai.vision({ image: "https://x/beach.png", prompt: "describe" });
  // F030: default vision tier resolves to mistral-small-latest over http (OpenAI-compatible)
  expect(seen[0]?.url).toBe("https://api.mistral.ai/v1/chat/completions");
  expect(res.text).toBe("a sunny beach");
  expect(res.usage.provider).toBe("mistral");
  expect(res.usage.tier).toBe("vision");
  expect(res.usage.capability).toBe("vision");
  expect(res.usage.inputTokens).toBe(1100);
  // url image block sent as an OpenAI image_url part
  const block = seen[0]?.body.messages[0].content[1];
  expect(block.type).toBe("image_url");
  expect(block.image_url.url).toBe("https://x/beach.png");
});

test("ai.vision() accepts raw bytes (Uint8Array → base64 data-URL image part)", async () => {
  const seen = mockMistral();
  const ai = createAI();
  const bytes = new Uint8Array([137, 80, 78, 71]); // PNG magic
  const res = await ai.vision({ image: bytes, prompt: "what is this", mimeType: "image/png" });
  expect(res.text).toBe("a sunny beach");
  const block = seen[0]?.body.messages[0].content[1];
  expect(block.type).toBe("image_url");
  expect(block.image_url.url).toMatch(/^data:image\/png;base64,/);
});

test("vision tier is overridable per call", async () => {
  mockMistral();
  const ai = createAI();
  const res = await ai.vision({ image: "https://x/p.png", prompt: "p", tier: "smart" });
  expect(res.usage.tier).toBe("smart");
});
