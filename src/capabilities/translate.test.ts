import { expect, test, afterEach } from "bun:test";
import { buildTranslateMessages, TRANSLATE_DEFAULT_TIER } from "./translate.js";
import { createAI as realCreateAI } from "../client.js";
import { stubProviders } from "../providers/stub.js";

const createAI = (cfg: Parameters<typeof realCreateAI>[0] = {}) =>
  realCreateAI({ providers: stubProviders, ...cfg });

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("TRANSLATE_DEFAULT_TIER is 'fast'", () => {
  expect(TRANSLATE_DEFAULT_TIER).toBe("fast");
});

test("buildTranslateMessages: system instruction + target language; from optional", () => {
  const m = buildTranslateMessages({ text: "hello", to: "Danish" });
  expect(m[0]?.role).toBe("system");
  expect(m[1]?.content).toContain("to Danish");
  expect(m[1]?.content).toContain("hello");
  expect(m[1]?.content).not.toContain("from");

  const withFrom = buildTranslateMessages({ text: "hej", to: "English", from: "Danish" });
  expect(withFrom[1]?.content).toContain("from Danish to English");
});

test("ai.translate() returns { text, usage } tagged capability translate, default tier fast", async () => {
  const ai = createAI();
  const res = await ai.translate({ text: "hello", to: "Danish" });
  expect(res.text).toBeString();
  expect(res.usage.capability).toBe("translate");
  expect(res.usage.tier).toBe("fast");
});

test("ai.translate() e2e through the live OpenRouter adapter (mocked fetch)", async () => {
  const seen: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(init!.body as string) });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "Goddag" } }], usage: { prompt_tokens: 9, completion_tokens: 2 } }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  // Route 'fast' tier to openrouter for this call so we hit a live adapter.
  const ai = realCreateAI({ providers: undefined });
  const res = await ai.translate({
    text: "hello",
    to: "Danish",
    override: { provider: "openrouter", model: "google/gemini-2.5-flash", transport: "http" },
  });
  expect(res.text).toBe("Goddag");
  expect(res.usage.provider).toBe("openrouter");
  expect(res.usage.capability).toBe("translate");
  // system + user messages forwarded
  expect(seen[0]?.body.messages).toHaveLength(2);
});
