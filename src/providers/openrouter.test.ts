import { expect, test, afterEach } from "bun:test";
import { openrouterAdapter } from "./openrouter.js";
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

test("openrouterAdapter satisfies ProviderAdapter", () => {
  expect(openrouterAdapter({ apiKey: "k" }).name).toBe("openrouter");
});

test("posts to OpenRouter with Authorization + HTTP-Referer + X-Title", async () => {
  const seen = mockFetch({
    choices: [{ message: { content: "ok" } }],
    usage: { prompt_tokens: 3, completion_tokens: 1 },
  });
  const a = openrouterAdapter({ apiKey: "or-key" });
  await a.chat!({
    messages: [{ role: "user", content: "hi" }],
    spec: { provider: "openrouter", model: "google/gemini-2.5-flash", transport: "http" },
  });
  expect(seen[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(seen[0]?.headers["Authorization"]).toBe("Bearer or-key");
  expect(seen[0]?.headers["HTTP-Referer"]).toBe("https://broberg.ai");
  expect(seen[0]?.headers["X-Title"]).toBe("@broberg/ai-sdk");
});

test("MiniMax M2.7 reachable via its model slug", async () => {
  const seen = mockFetch({
    choices: [{ message: { content: "minimax says hi" } }],
    usage: { prompt_tokens: 10, completion_tokens: 4 },
  });
  const a = openrouterAdapter({ apiKey: "k" });
  const res = await a.chat!({
    messages: [{ role: "user", content: "hi" }],
    spec: { provider: "openrouter", model: "minimax/minimax-m2.7", transport: "http" },
  });
  expect((seen[0]?.body as { model: string }).model).toBe("minimax/minimax-m2.7");
  expect(res.text).toBe("minimax says hi");
  expect(res.usage.provider).toBe("openrouter");
  expect(res.usage.inputTokens).toBe(10);
});
