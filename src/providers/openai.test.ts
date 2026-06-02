import { expect, test, afterEach } from "bun:test";
import { openaiAdapter } from "./openai.js";
import type { ChatRequest } from "../types.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(response: unknown, status = 200) {
  const seen: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(init!.body as string) });
    return new Response(JSON.stringify(response), { status });
  }) as unknown as typeof fetch;
  return seen;
}

const req: ChatRequest = {
  messages: [{ role: "user", content: "Hello" }],
  spec: { provider: "openai", model: "gpt-4o-mini", transport: "http" },
};

test("openaiAdapter satisfies ProviderAdapter (chat + vision)", () => {
  const a = openaiAdapter({ apiKey: "k" });
  expect(a.name).toBe("openai");
  expect(typeof a.chat).toBe("function");
  expect(typeof a.vision).toBe("function");
});

test("chat() POSTs a valid completion request and parses text + usage", async () => {
  const seen = mockFetch({
    choices: [{ message: { content: "Hi there" } }],
    usage: { prompt_tokens: 12, completion_tokens: 3 },
  });
  const a = openaiAdapter({ apiKey: "sk-test" });
  const res = await a.chat!(req);
  expect(seen[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
  expect((seen[0]?.body as { model: string }).model).toBe("gpt-4o-mini");
  expect(res.text).toBe("Hi there");
  expect(res.usage.inputTokens).toBe(12);
  expect(res.usage.outputTokens).toBe(3);
  expect(res.usage.provider).toBe("openai");
});

test("tool calls round-trip via the F4.5 contract", async () => {
  mockFetch({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Aalborg"}' } },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 8 },
  });
  const a = openaiAdapter({ apiKey: "k" });
  const res = await a.chat!({
    ...req,
    tools: [{ name: "get_weather", description: "w", parameters: { type: "object" } }],
  });
  expect(res.toolCalls?.[0]).toEqual({
    id: "call_1",
    name: "get_weather",
    arguments: { city: "Aalborg" },
  });
});

test("vision sends image_url content parts", async () => {
  const seen = mockFetch({
    choices: [{ message: { content: "a cat" } }],
    usage: { prompt_tokens: 100, completion_tokens: 5 },
  });
  const a = openaiAdapter({ apiKey: "k" });
  await a.vision!({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image", image: "https://x/cat.png" },
        ],
      },
    ],
    spec: { provider: "openai", model: "gpt-4o", transport: "http" },
  });
  const content = (seen[0]?.body as { messages: { content: { type: string }[] }[] }).messages[0]!
    .content;
  expect(content.map((c) => c.type)).toEqual(["text", "image_url"]);
});

test("non-2xx throws with provider + status", async () => {
  mockFetch({ error: { message: "bad key" } }, 401);
  const a = openaiAdapter({ apiKey: "k" });
  await expect(a.chat!(req)).rejects.toThrow(/openai 401/);
});

test("missing API key throws a clear error", async () => {
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const a = openaiAdapter();
  await expect(a.chat!(req)).rejects.toThrow(/API key not set/);
  if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
});
