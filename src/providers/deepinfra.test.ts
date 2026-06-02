import { expect, test, afterEach } from "bun:test";
import { deepinfraAdapter } from "./deepinfra.js";
import type { ChatRequest } from "../types.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(response: unknown, status = 200) {
  const seen: { url: string; headers: Record<string, string>; body: unknown }[] = [];
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

const req: ChatRequest = {
  messages: [{ role: "user", content: "hi" }],
  spec: { provider: "deepinfra", model: "meta-llama/Llama-3.3-70B-Instruct", transport: "http" },
};

test("deepinfraAdapter satisfies ProviderAdapter", () => {
  expect(deepinfraAdapter({ apiKey: "k" }).name).toBe("deepinfra");
});

test("chat() posts to the DeepInfra OpenAI-compatible endpoint with Bearer auth", async () => {
  const seen = mockFetch({
    choices: [{ message: { content: "yo" } }],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  });
  const a = deepinfraAdapter({ apiKey: "di-key" });
  const res = await a.chat!(req);
  expect(seen[0]?.url).toBe("https://api.deepinfra.com/v1/openai/chat/completions");
  expect(seen[0]?.headers["Authorization"]).toBe("Bearer di-key");
  expect(res.text).toBe("yo");
  expect(res.usage.inputTokens).toBe(5);
  expect(res.usage.outputTokens).toBe(2);
  expect(res.usage.provider).toBe("deepinfra");
});
