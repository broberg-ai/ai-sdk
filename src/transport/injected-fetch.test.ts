// F073 — an injected fetch must be used on EVERY path, never the global one.
// Measured 2026-10-07 (scout via components): mistralAdapter({fetch}).chat() reached the
// real api.mistral.ai — a test that believed it was isolated sent a real call.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mistralAdapter } from "../providers/mistral.js";
import { openaiAdapter } from "../providers/openai.js";
import { anthropicAdapter } from "../providers/anthropic.js";
import { geminiAdapter } from "../providers/gemini.js";
import { makeOpenAICompatibleAdapter } from "../providers/openai-compatible.js";

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (async () => {
    throw new Error("GLOBAL fetch was used — the injected one was bypassed");
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

function spy(body: unknown) {
  const calls: string[] = [];
  const f = (async (url: string | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, f };
}
const OA = { model: "m", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
const msg = [{ role: "user" as const, content: "hej" }];

test("mistral chat uses the injected fetch", async () => {
  const { calls, f } = spy(OA);
  const r = await mistralAdapter({ apiKey: "k", fetch: f }).chat!({ messages: msg, spec: { provider: "mistral", model: "mistral-small-latest", transport: "http" } });
  expect(r.text).toBe("ok");
  expect(calls).toHaveLength(1);
});

test("openai-compatible chat uses the injected fetch", async () => {
  const { calls, f } = spy(OA);
  await makeOpenAICompatibleAdapter({ name: "x", baseUrl: "https://x.test/v1", apiKey: "k", fetch: f }).chat!({ messages: msg, spec: { provider: "x", model: "m", transport: "http" } });
  expect(calls).toEqual(["https://x.test/v1/chat/completions"]);
});

test("openai chat AND embedding use the injected fetch", async () => {
  const { calls, f } = spy({ ...OA, data: [{ embedding: [0.1, 0.2] }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 1 } });
  const a = openaiAdapter({ apiKey: "k", fetch: f });
  await a.chat!({ messages: msg, spec: { provider: "openai", model: "gpt-4o-mini", transport: "http" } });
  await a.embedding!({ input: ["hej"], spec: { provider: "openai", model: "text-embedding-3-small", transport: "http" } });
  expect(calls).toHaveLength(2);
});

test("anthropic chat uses the injected fetch", async () => {
  const { calls, f } = spy({ model: "c", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } });
  await anthropicAdapter({ apiKey: "k", fetch: f }).chat!({ messages: msg, spec: { provider: "anthropic", model: "claude-haiku-4-5", transport: "http" } });
  expect(calls).toHaveLength(1);
});

test("gemini chat uses the injected fetch", async () => {
  const { calls, f } = spy({ candidates: [{ content: { parts: [{ text: "ok" }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
  await geminiAdapter({ apiKey: "k", fetch: f }).chat!({ messages: msg, spec: { provider: "gemini", model: "gemini-2.5-flash", transport: "http" } });
  expect(calls).toHaveLength(1);
});
