import { expect, test } from "bun:test";
import { deeplAdapter } from "./deepl.js";

const spec = { provider: "deepl", model: "deepl", transport: "http" as const };

function deeplFetch(capture: { url?: string; body?: string; headers?: Headers }, translation = "Hej fra planen") {
  return (async (url: string, init?: RequestInit) => {
    capture.url = url;
    capture.body = String(init?.body);
    capture.headers = new Headers(init?.headers);
    return new Response(JSON.stringify({ translations: [{ text: translation, detected_source_language: "EN" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

test("Free-tier key (ending :fx) routes to api-free.deepl.com", async () => {
  const cap: { url?: string; body?: string; headers?: Headers } = {};
  const adapter = deeplAdapter({ apiKey: "abc123:fx", fetch: deeplFetch(cap) });
  await adapter.translate!({ text: "Hi from the plan", to: "DA", spec });
  expect(cap.url).toBe("https://api-free.deepl.com/v2/translate");
});

test("Pro key (no :fx suffix) routes to api.deepl.com", async () => {
  const cap: { url?: string; body?: string; headers?: Headers } = {};
  const adapter = deeplAdapter({ apiKey: "abc123", fetch: deeplFetch(cap) });
  await adapter.translate!({ text: "Hi from the plan", to: "DA", spec });
  expect(cap.url).toBe("https://api.deepl.com/v2/translate");
});

test("request body + headers match DeepL's documented shape (not Bearer)", async () => {
  const cap: { url?: string; body?: string; headers?: Headers } = {};
  const adapter = deeplAdapter({ apiKey: "k:fx", fetch: deeplFetch(cap) });
  await adapter.translate!({ text: "Hi from the plan", to: "da", from: "en", spec });
  const body = JSON.parse(cap.body!);
  expect(body.text).toEqual(["Hi from the plan"]);
  expect(body.target_lang).toBe("DA"); // uppercased
  expect(body.source_lang).toBe("EN"); // uppercased
  expect(cap.headers!.get("authorization")).toBe("DeepL-Auth-Key k:fx"); // DeepL's own scheme, not Bearer
});

test("omits source_lang when `from` is not given", async () => {
  const cap: { url?: string; body?: string; headers?: Headers } = {};
  const adapter = deeplAdapter({ apiKey: "k:fx", fetch: deeplFetch(cap) });
  await adapter.translate!({ text: "Hi", to: "DA", spec });
  const body = JSON.parse(cap.body!);
  expect(body.source_lang).toBeUndefined();
});

test("parses the translated text from the response", async () => {
  const adapter = deeplAdapter({ apiKey: "k:fx", fetch: deeplFetch({}, "Hej fra planen") });
  const { text } = await adapter.translate!({ text: "Hi from the plan", to: "DA", spec });
  expect(text).toBe("Hej fra planen");
});

test("cost: per-1k-char rate, overridable via config", async () => {
  const adapter = deeplAdapter({ apiKey: "k:fx", fetch: deeplFetch({}), pricePer1kChars: 0.05 });
  const { usage } = await adapter.translate!({ text: "1234567890", to: "DA", spec }); // 10 chars
  expect(usage.provider).toBe("deepl");
  expect(usage.capability).toBe("translate");
  expect(usage.costUsd).toBeCloseTo((10 / 1000) * 0.05, 9);
});

test("default price estimate is used when no override is given", async () => {
  const adapter = deeplAdapter({ apiKey: "k:fx", fetch: deeplFetch({}) });
  const { usage } = await adapter.translate!({ text: "1234567890", to: "DA", spec }); // 10 chars
  expect(usage.costUsd).toBeCloseTo((10 / 1000) * 0.0217, 9);
});

test("ship-dark: no key → throws only when translate() is called", async () => {
  const prev = process.env.DEEPL_API_KEY;
  delete process.env.DEEPL_API_KEY;
  try {
    const adapter = deeplAdapter(); // no throw at construction
    await expect(adapter.translate!({ text: "hi", to: "DA", spec })).rejects.toThrow(/DEEPL_API_KEY/);
  } finally {
    if (prev !== undefined) process.env.DEEPL_API_KEY = prev;
  }
});

test("non-200 surfaces the DeepL error body", async () => {
  const adapter = deeplAdapter({
    apiKey: "k:fx",
    fetch: (async () => new Response("Forbidden", { status: 403 })) as unknown as typeof fetch,
  });
  await expect(adapter.translate!({ text: "hi", to: "DA", spec })).rejects.toThrow(/deepl translate 403/);
});

test("ai.translate({ override:{provider:'deepl'} }) routes to deeplAdapter.translate directly, not chat", async () => {
  const { createAI } = await import("../client.js");
  const cap: { url?: string; body?: string; headers?: Headers } = {};
  const ai = createAI({ providers: { deepl: deeplAdapter({ apiKey: "k:fx", fetch: deeplFetch(cap, "Hej fra planen") }) } });
  const { text, usage } = await ai.translate({ text: "Hi from the plan", to: "DA", override: { provider: "deepl", model: "deepl" } });
  expect(text).toBe("Hej fra planen");
  expect(usage.provider).toBe("deepl");
  expect(cap.url).toContain("deepl.com/v2/translate");
});

test("regression: a provider WITHOUT .translate still routes through chat (unchanged behavior)", async () => {
  const { createAI } = await import("../client.js");
  const { freshUsage } = await import("../cost/usage.js");
  const calls: { messages?: unknown }[] = [];
  const chatOnlyAdapter = {
    name: "stub-chat-only",
    async chat(req: { messages: unknown; spec: { model: string } }) {
      calls.push({ messages: req.messages });
      return {
        text: "chat-routed translation",
        usage: freshUsage({ provider: "stub-chat-only", model: req.spec.model, transport: "http", capability: "translate", inputTokens: 0, outputTokens: 0 }),
      };
    },
  };
  const ai = createAI({ providers: { "stub-chat-only": chatOnlyAdapter } });
  const { text } = await ai.translate({ text: "hello", to: "Danish", override: { provider: "stub-chat-only", model: "x" } });
  expect(text).toBe("chat-routed translation");
  expect(calls.length).toBe(1);
  expect(Array.isArray(calls[0]!.messages)).toBe(true); // buildTranslateMessages() was used, proving the chat fallback fired
});
