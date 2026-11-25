// F097.1 — every OpenRouter call goes to eu.openrouter.ai; Recraft images are the one
// deliberate exception (owner 2026-11-26).
import { expect, test } from "bun:test";
import { openrouterAdapter } from "./openrouter.js";
import { createAI } from "../client.js";
import { LATEST } from "../routing/latest.js";
import { regionOfHost } from "../cost/region.js";
import { SECOND_OPINION_PANEL } from "../capabilities/second-opinion.js";

function fake() {
  const urls: string[] = [];
  const f = (async (url: string | URL) => {
    urls.push(String(url));
    const u = String(url);
    const body = u.endsWith("/images")
      ? { data: [{ b64_json: "cGFzdGU=" }], usage: { cost: 0.01 } }
      : { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.00001 } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, urls };
}

test("F097 a default OpenRouter chat goes to the EU host and reports region eu", async () => {
  const { f, urls } = fake();
  const ai = createAI({ costSink: null, providers: { openrouter: openrouterAdapter({ apiKey: "k", fetch: f }) } });
  const r = await ai.chat({ prompt: "x", override: { provider: "openrouter", model: "anthropic/claude-sonnet-5.5" } });
  expect(urls[0]).toBe("https://eu.openrouter.ai/api/v1/chat/completions");
  expect(r.usage.region).toBe("eu");
});

test("F097 recraft/* images go to the GLOBAL host (the deliberate exception); any other image model stays on EU", async () => {
  const { f, urls } = fake();
  const a = openrouterAdapter({ apiKey: "k", fetch: f });
  const rec = await a.image!({ prompt: "x", spec: { provider: "openrouter", model: "recraft/recraft-v4.1-vector", transport: "http" } });
  const other = await a.image!({ prompt: "x", spec: { provider: "openrouter", model: "google/gemini-4-neon", transport: "http" } });
  expect(urls).toEqual(["https://openrouter.ai/api/v1/images", "https://eu.openrouter.ai/api/v1/images"]);
  expect(rec.usage.region).toBe("unknown");
  expect(other.usage.region).toBe("eu");
});

test("F097 a caller's own baseUrl still wins (no forced EU, no forced exception)", async () => {
  const { f, urls } = fake();
  await openrouterAdapter({ apiKey: "k", fetch: f, baseUrl: "https://openrouter.ai/api/v1" })
    .image!({ prompt: "x", spec: { provider: "openrouter", model: "recraft/recraft-v4.1", transport: "http" } });
  expect(urls[0]).toBe("https://openrouter.ai/api/v1/images");
});

test("F097 region map: eu.openrouter.ai is eu, the global host stays unknown", () => {
  expect(regionOfHost("https://eu.openrouter.ai/api/v1")).toBe("eu");
  expect(regionOfHost("https://openrouter.ai/api/v1")).toBe("unknown");
});

test("F097 every LATEST family and secondOpinion's DeepSeek answer from the EU", async () => {
  const { f } = fake();
  const providers = { openrouter: openrouterAdapter({ apiKey: "k", fetch: f }) } as const;
  const ai = createAI({ costSink: null, providers });
  for (const e of LATEST.filter((x) => x.provider === "openrouter")) {
    const r = await ai.chat({ prompt: "x", override: { model: e.alias } });
    expect({ alias: e.alias, region: r.usage.region }).toEqual({ alias: e.alias, region: "eu" });
  }
  expect(LATEST.every((e) => e.provider === "openrouter" || e.provider === "mistral")).toBe(true);
  const ds = SECOND_OPINION_PANEL.find((p) => p.model.startsWith("deepseek/"));
  expect(ds?.model).toBe("deepseek/deepseek-v4-flash-0731");
});

test("F097 any OpenRouter id WITHOUT a provider routes via OpenRouter EU; Mistral and other slash ids are not captured", async () => {
  const { f, urls } = fake();
  const mistralSeen: string[] = [];
  const mistral = { name: "mistral", async chat(req: any) { mistralSeen.push(req.spec.model); return { text: "ok", usage: { provider: "mistral", model: req.spec.model, transport: "http", inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 0, capability: "chat", ts: "" } }; } } as any;
  const ai = createAI({ costSink: null, providers: { openrouter: openrouterAdapter({ apiKey: "k", fetch: f }), mistral } });
  const r = await ai.chat({ prompt: "x", override: { model: "moonshotai/kimi-k2.6" } });
  expect({ provider: r.usage.provider, model: r.usage.model, region: r.usage.region }).toEqual({ provider: "openrouter", model: "moonshotai/kimi-k2.6", region: "eu" });
  expect(urls[0]).toBe("https://eu.openrouter.ai/api/v1/chat/completions");
  // mistralai/ is NOT captured — Mistral is called direct; a model-only Mistral id stays on the tier's provider.
  await ai.chat({ prompt: "x", override: { model: "mistral-small-2603" } });
  expect(mistralSeen).toEqual(["mistral-small-2603"]);
});
