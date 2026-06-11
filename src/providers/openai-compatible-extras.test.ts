import { expect, test } from "bun:test";
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import { openrouterAdapter } from "./openrouter.js";
import type { ChatRequest } from "../types.js";

const spec = { provider: "openrouter", model: "anthropic/claude-haiku-4.5", transport: "http" as const };
const baseReq: ChatRequest = { messages: [{ role: "user", content: "hi" }], spec };

/** Fake streaming fetch that records the request body and returns a minimal stream. */
function captureStreamFetch(record: (body: Record<string, unknown>) => void, usageCost?: number): typeof fetch {
  return (async (_url: string, init: { body?: string }) => {
    record(JSON.parse(init.body ?? "{}"));
    const usage = usageCost !== undefined
      ? `data: {"choices":[],"usage":{"prompt_tokens":89,"completion_tokens":9,"cost":${usageCost}}}\n\n`
      : "";
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n' + usage + "data: [DONE]\n\n"));
        c.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

async function drainStream(it: AsyncIterable<{ type: string }>): Promise<{ type: string }[]> {
  const out: { type: string }[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

// chat() uses the global-fetch http transport (config.fetch is streaming-only), so mock global.
async function chatWithGlobalFetch(json: unknown): Promise<string> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(json), { status: 200 })) as unknown as typeof fetch;
  try {
    const adapter = makeOpenAICompatibleAdapter({ name: "mistral", baseUrl: "https://x/v1", apiKey: "k" });
    return (await adapter.chat!(baseReq)).text;
  } finally {
    globalThis.fetch = real;
  }
}

test("chat() coerces array message.content to a string (reasoning models) (cms #4423)", async () => {
  const text = await chatWithGlobalFetch({
    choices: [{ message: { content: [{ type: "text", text: "Hello " }, { type: "text", text: "world" }] } }],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  });
  expect(typeof text).toBe("string"); // never an array → no `text.replace is not a function`
  expect(text).toBe("Hello world");
});

test("chat() returns '' (not null) when content is missing", async () => {
  const text = await chatWithGlobalFetch({ choices: [{ message: { content: null } }], usage: {} });
  expect(text).toBe("");
});

// ── F9.1: JSON mode ─────────────────────────────────────────────────────────

test("responseFormat:'json' sets response_format on the body (chatStream)", async () => {
  let sent: Record<string, unknown> = {};
  const adapter = makeOpenAICompatibleAdapter({ name: "openrouter", baseUrl: "x", apiKey: "k", fetch: captureStreamFetch((b) => (sent = b)) });
  await drainStream(adapter.chatStream!({ ...baseReq, responseFormat: "json" }));
  expect(sent.response_format).toEqual({ type: "json_object" });
});

test("no response_format when responseFormat is absent", async () => {
  let sent: Record<string, unknown> = {};
  const adapter = makeOpenAICompatibleAdapter({ name: "openrouter", baseUrl: "x", apiKey: "k", fetch: captureStreamFetch((b) => (sent = b)) });
  await drainStream(adapter.chatStream!(baseReq));
  expect(sent.response_format).toBeUndefined();
});

// ── F10.1: OpenRouter ground-truth cost ─────────────────────────────────────

test("openrouter adapter sets usage:{include:true} and uses usage.cost over the estimate (stream)", async () => {
  let sent: Record<string, unknown> = {};
  // openrouterAdapter wires costFromResponseField:true + injectable fetch via baseUrl override is not exposed,
  // so build the core directly with the same flag to assert behaviour.
  const adapter = makeOpenAICompatibleAdapter({
    name: "openrouter",
    baseUrl: "x",
    apiKey: "k",
    costFromResponseField: true,
    fetch: captureStreamFetch((b) => (sent = b), 0.00042),
  });
  const events = await drainStream(adapter.chatStream!(baseReq));
  expect(sent.usage).toEqual({ include: true });
  const usageEv = events.find((e) => e.type === "usage") as unknown as { costUsd: number };
  expect(usageEv.costUsd).toBe(0.00042); // ground-truth, not the pricing-table estimate
});

test("openai adapter does NOT set usage:{include:true}", async () => {
  let sent: Record<string, unknown> = {};
  const adapter = makeOpenAICompatibleAdapter({ name: "openai", baseUrl: "x", apiKey: "k", fetch: captureStreamFetch((b) => (sent = b)) });
  await drainStream(adapter.chatStream!({ ...baseReq, spec: { ...spec, provider: "openai", model: "gpt-4o" } }));
  expect(sent.usage).toBeUndefined();
});

test("openrouter non-stream chat uses usage.cost as costUsd", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 89, completion_tokens: 9, cost: 0.00099 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  try {
    const adapter = openrouterAdapter({ apiKey: "k" });
    const res = await adapter.chat!(baseReq);
    expect(res.usage.costUsd).toBe(0.00099);
  } finally {
    globalThis.fetch = realFetch;
  }
});
