import { expect, test } from "bun:test";
import { geminiAdapter } from "./gemini.js";

function jsonFetch(payload: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

const spec = { provider: "gemini", model: "gemini-2.5-flash-image", transport: "http" as const };

test("returns the inline image as a data URL + per-image cost (camelCase)", async () => {
  const adapter = geminiAdapter({
    apiKey: "k",
    fetch: jsonFetch({
      candidates: [{ content: { parts: [{ text: "here you go" }, { inlineData: { mimeType: "image/png", data: "AAAB" } }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
    }),
  });
  const { url, usage } = await adapter.image!({ prompt: "a cat", spec });
  expect(url).toBe("data:image/png;base64,AAAB");
  expect(usage.costUsd).toBe(0.039); // nano-banana per-image
  expect(usage.capability).toBe("image");
  expect(usage.inputTokens).toBe(12);
});

test("parses the snake_case inline_data alias", async () => {
  const adapter = geminiAdapter({
    apiKey: "k",
    fetch: jsonFetch({ candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/jpeg", data: "ZZZ" } }] } }] }),
  });
  const { url } = await adapter.image!({ prompt: "x", spec });
  expect(url).toBe("data:image/jpeg;base64,ZZZ");
});

test("config.pricePerImage overrides the model default", async () => {
  const adapter = geminiAdapter({
    apiKey: "k",
    pricePerImage: 0.05,
    fetch: jsonFetch({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AA" } }] } }] }),
  });
  const { usage } = await adapter.image!({ prompt: "x", spec });
  expect(usage.costUsd).toBe(0.05);
});

test("promptFeedback.blockReason throws a clear error", async () => {
  const adapter = geminiAdapter({ apiKey: "k", fetch: jsonFetch({ promptFeedback: { blockReason: "SAFETY" } }) });
  await expect(adapter.image!({ prompt: "x", spec })).rejects.toThrow(/blocked: SAFETY/);
});

test("no inline image part throws", async () => {
  const adapter = geminiAdapter({ apiKey: "k", fetch: jsonFetch({ candidates: [{ content: { parts: [{ text: "only text" }] } }] }) });
  await expect(adapter.image!({ prompt: "x", spec })).rejects.toThrow(/no inline image data/);
});

test("ai.image routes to gemini via override", async () => {
  const { createAI } = await import("../client.js");
  const ai = createAI({
    providers: {
      gemini: geminiAdapter({ apiKey: "k", fetch: jsonFetch({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QQ" } }] } }] }) }),
    },
  });
  const { url, usage } = await ai.image({ prompt: "logo", override: { provider: "gemini", model: "gemini-3-pro-image-preview", transport: "http" } });
  expect(url).toBe("data:image/png;base64,QQ");
  expect(usage.capability).toBe("image");
});
