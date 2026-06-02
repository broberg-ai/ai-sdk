import { expect, test, afterEach } from "bun:test";
import { anthropicAdapter } from "./anthropic.js";
import type { ChatRequest } from "../types.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(response: unknown, status = 200) {
  const seen: { url: string; headers: Record<string, string>; body: any }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      headers: (init!.headers ?? {}) as Record<string, string>,
      body: JSON.parse(init!.body as string),
    });
    return new Response(JSON.stringify(response), { status });
  }) as unknown as typeof fetch;
  return seen;
}

const httpSpec = { provider: "anthropic", model: "claude-sonnet-4-6", transport: "http" as const };

test("anthropicAdapter satisfies ProviderAdapter (chat + vision)", () => {
  const a = anthropicAdapter({ apiKey: "k" });
  expect(a.name).toBe("anthropic");
  expect(typeof a.chat).toBe("function");
  expect(typeof a.vision).toBe("function");
});

test("http chat: x-api-key + anthropic-version, max_tokens default, text + cache-token usage", async () => {
  const seen = mockFetch({
    content: [{ type: "text", text: "Hej Christian" }],
    usage: {
      input_tokens: 1340,
      output_tokens: 95,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 50,
    },
  });
  const a = anthropicAdapter({ apiKey: "sk-ant" });
  const res = await a.chat!({ messages: [{ role: "user", content: "hej" }], spec: httpSpec });
  expect(seen[0]?.url).toBe("https://api.anthropic.com/v1/messages");
  expect(seen[0]?.headers["x-api-key"]).toBe("sk-ant");
  expect(seen[0]?.headers["anthropic-version"]).toBe("2023-06-01");
  expect(seen[0]?.body.max_tokens).toBe(1024); // required default
  expect(res.text).toBe("Hej Christian");
  expect(res.usage.inputTokens).toBe(1340);
  expect(res.usage.outputTokens).toBe(95);
  expect(res.usage.cacheReadTokens).toBe(200);
  expect(res.usage.cacheCreationTokens).toBe(50);
  expect(res.usage.provider).toBe("anthropic");
  expect(res.usage.transport).toBe("http");
});

test("system messages map to the top-level system field", async () => {
  const seen = mockFetch({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } });
  const a = anthropicAdapter({ apiKey: "k" });
  await a.chat!({
    messages: [
      { role: "system", content: "Be terse." },
      { role: "user", content: "hi" },
    ],
    spec: httpSpec,
  });
  expect(seen[0]?.body.system).toBe("Be terse.");
  expect(seen[0]?.body.messages).toHaveLength(1); // system not in messages array
});

test("vision: URL image → url source, bytes → base64 source", async () => {
  const seen = mockFetch({ content: [{ type: "text", text: "a cat" }], usage: { input_tokens: 100, output_tokens: 5 } });
  const a = anthropicAdapter({ apiKey: "k" });
  await a.vision!({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "describe" },
          { type: "image", image: "https://x/cat.png" },
        ],
      },
    ],
    spec: httpSpec,
  });
  const blocks = seen[0]?.body.messages[0].content;
  expect(blocks[0]).toEqual({ type: "text", text: "describe" });
  expect(blocks[1].source.type).toBe("url");
  expect(blocks[1].source.url).toBe("https://x/cat.png");
});

test("tool_use blocks parse into normalized toolCalls", async () => {
  mockFetch({
    content: [
      { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Aalborg" } },
    ],
    usage: { input_tokens: 20, output_tokens: 8 },
  });
  const a = anthropicAdapter({ apiKey: "k" });
  const res = await a.chat!({
    messages: [{ role: "user", content: "weather?" }],
    spec: httpSpec,
    tools: [{ name: "get_weather", description: "w", parameters: { type: "object" } }],
  });
  expect(res.toolCalls?.[0]).toEqual({ id: "toolu_1", name: "get_weather", arguments: { city: "Aalborg" } });
});

test("non-2xx throws with provider + status; missing key throws", async () => {
  mockFetch({ error: { type: "authentication_error" } }, 401);
  await expect(
    anthropicAdapter({ apiKey: "k" }).chat!({ messages: [{ role: "user", content: "x" }], spec: httpSpec }),
  ).rejects.toThrow(/anthropic 401/);

  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  await expect(
    anthropicAdapter().chat!({ messages: [{ role: "user", content: "x" }], spec: httpSpec }),
  ).rejects.toThrow(/API key not set/);
  if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
});
