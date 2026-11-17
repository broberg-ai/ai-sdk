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

// ── F091 — DeepInfra's own price (usage.estimated_cost) is what gets booked ──
test("F091 chat books usage.estimated_cost as the cost, basis reported, no usage:{include}", async () => {
  const seen = mockFetch({
    choices: [{ message: { role: "assistant", content: "ok" } }],
    usage: { prompt_tokens: 11, completion_tokens: 3, estimated_cost: 0.00012 },
  });
  const r = await deepinfraAdapter({ apiKey: "k" }).chat!(req);
  expect(r.usage.costUsd).toBe(0.00012);
  expect(r.usage.costBasis).toBe("reported");
  expect((seen[0]!.body as Record<string, unknown>).usage).toBeUndefined();
});

test("F091 without estimated_cost the model stays unpriced (no invented number)", async () => {
  mockFetch({ choices: [{ message: { role: "assistant", content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const r = await deepinfraAdapter({ apiKey: "k" }).chat!(req);
  expect(r.usage.costUsd).toBe(0);
  expect(r.usage.costBasis).toBe("unpriced");
});

test("F091 stream books estimated_cost from the usage chunk", async () => {
  const sse =
    'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
    'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":3,"estimated_cost":0.00012}}\n\n' +
    "data: [DONE]\n\n";
  globalThis.fetch = (async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
  let usage: { costUsd: number; costBasis?: string } | undefined;
  for await (const ev of deepinfraAdapter({ apiKey: "k" }).chatStream!(req)) if (ev.type === "usage") usage = ev.usage;
  expect(usage?.costUsd).toBe(0.00012);
  expect(usage?.costBasis).toBe("reported");
});
