// F071.2 — the model that ANSWERED travels with the usage and reaches upmetrics.
import { afterEach, expect, test } from "bun:test";
import { createAI } from "../client.js";
import { makeOpenAICompatibleAdapter } from "../providers/openai-compatible.js";
import { anthropicAdapter } from "../providers/anthropic.js";
import { upmetricsSink } from "./sinks/upmetrics.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stub(body: unknown) {
  return (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

test("OpenAI-shaped adapters (Mistral too) set servedModel from the response; model stays the one asked for", async () => {
  globalThis.fetch = stub({ model: "mistral-large-2512", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const a = makeOpenAICompatibleAdapter({ name: "mistral", baseUrl: "https://api.mistral.ai/v1", apiKey: "k" });
  const r = await a.chat!({ messages: [{ role: "user", content: "hej" }], spec: { provider: "mistral", model: "mistral-large-latest", transport: "http" } });
  expect(r.usage.model).toBe("mistral-large-latest");
  expect(r.usage.servedModel).toBe("mistral-large-2512");
});

test("no model in the response → servedModel is NOT guessed", async () => {
  globalThis.fetch = stub({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const a = makeOpenAICompatibleAdapter({ name: "x", baseUrl: "https://x.test/v1", apiKey: "k" });
  const r = await a.chat!({ messages: [{ role: "user", content: "hej" }], spec: { provider: "x", model: "m", transport: "http" } });
  expect(r.usage.servedModel).toBeUndefined();
});

test("Anthropic sets servedModel from the response", async () => {
  globalThis.fetch = stub({ model: "claude-sonnet-4-6-20260101", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } });
  const r = await anthropicAdapter({ apiKey: "k" }).chat!({ messages: [{ role: "user", content: "hej" }], spec: { provider: "anthropic", model: "claude-sonnet-4-6", transport: "http" } });
  expect(r.usage.servedModel).toBe("claude-sonnet-4-6-20260101");
});

test("the upmetrics row carries tags.served_model; model stays the requested one", async () => {
  const bodies: Record<string, unknown>[] = [];
  const sink = upmetricsSink({ baseUrl: "https://u.test", apiKey: "uk", agentName: "t", retry: false,
    fetch: (async (_u: string, init?: RequestInit) => { bodies.push(JSON.parse(String(init!.body))); return new Response("{}"); }) as typeof fetch });
  globalThis.fetch = stub({ model: "mistral-large-2512", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const mistral = makeOpenAICompatibleAdapter({ name: "mistral", baseUrl: "https://api.mistral.ai/v1", apiKey: "k" });
  const ai = createAI({ providers: { mistral }, costSink: sink });
  // An explicit -latest override: the case where requested and served differ (F077 pinned the tiers).
  await ai.chat({ prompt: "hej", override: { provider: "mistral", model: "mistral-large-latest", transport: "http" } });
  expect(bodies[0]!.model).toBe("mistral-large-latest");
  expect((bodies[0]!.tags as Record<string, string>).served_model).toBe("mistral-large-2512");
});
