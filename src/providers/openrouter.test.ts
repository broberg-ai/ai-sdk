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

// F033.1 — Recraft V4.1 via OpenRouter's unified Image API.
test("image() posts to /images and decodes a raster png (Recraft V4.1)", async () => {
  const seen = mockFetch({
    data: [{ b64_json: "cGFzdGU=" }],
    usage: { cost: 0.035 },
  });
  const a = openrouterAdapter({ apiKey: "or-key" });
  const res = await a.image!({
    prompt: "a broberg.ai brand logo, minimal, blue",
    spec: { provider: "openrouter", model: "recraft/recraft-v4.1", transport: "http" },
  });
  expect(seen[0]?.url).toBe("https://openrouter.ai/api/v1/images");
  expect(seen[0]?.headers["Authorization"]).toBe("Bearer or-key");
  expect((seen[0]?.body as { model: string }).model).toBe("recraft/recraft-v4.1");
  expect(res.url).toBe("data:image/png;base64,cGFzdGU=");
  expect(res.usage.costUsd).toBe(0.035);
  expect(res.usage.capability).toBe("image");
});

test("image() decodes SVG output (Recraft V4.1 Vector) via media_type", async () => {
  const seen = mockFetch({
    data: [{ b64_json: "PHN2Zz48L3N2Zz4=", media_type: "image/svg+xml" }],
    usage: { cost: 0.08 },
  });
  const a = openrouterAdapter({ apiKey: "or-key" });
  const res = await a.image!({
    prompt: "a broberg.ai logo as scalable vector art",
    spec: { provider: "openrouter", model: "recraft/recraft-v4.1-vector", transport: "http" },
  });
  expect(res.url).toBe("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
  expect(res.usage.costUsd).toBe(0.08);
  expect((seen[0]?.body as { model: string }).model).toBe("recraft/recraft-v4.1-vector");
});

test("image() falls back to the price estimate when usage.cost is absent", async () => {
  mockFetch({ data: [{ b64_json: "cGFzdGU=" }] });
  const a = openrouterAdapter({ apiKey: "or-key" });
  const res = await a.image!({
    prompt: "brand illustration",
    spec: { provider: "openrouter", model: "recraft/recraft-v4.1", transport: "http" },
  });
  expect(res.usage.costUsd).toBe(0.035);
});

test("image() forwards seed + outputFormat to the request body", async () => {
  const seen = mockFetch({ data: [{ b64_json: "cGFzdGU=" }], usage: { cost: 0.035 } });
  const a = openrouterAdapter({ apiKey: "or-key" });
  await a.image!({
    prompt: "reproducible brand mark",
    seed: 42,
    outputFormat: "webp",
    spec: { provider: "openrouter", model: "recraft/recraft-v4.1", transport: "http" },
  });
  const body = seen[0]?.body as { seed?: number; output_format?: string };
  expect(body.seed).toBe(42);
  expect(body.output_format).toBe("webp");
});

test("image() surfaces OpenRouter's error payload on an empty-data 200", async () => {
  mockFetch({ data: [], error: { message: "content policy violation" } });
  const a = openrouterAdapter({ apiKey: "or-key" });
  await expect(
    a.image!({
      prompt: "blocked",
      spec: { provider: "openrouter", model: "recraft/recraft-v4.1", transport: "http" },
    }),
  ).rejects.toThrow(/content policy violation/);
});

test("image() throws without an API key", async () => {
  const prevKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const a = openrouterAdapter({});
  await expect(
    a.image!({
      prompt: "x",
      spec: { provider: "openrouter", model: "recraft/recraft-v4.1", transport: "http" },
    }),
  ).rejects.toThrow(/OPENROUTER_API_KEY not set/);
  if (prevKey !== undefined) process.env.OPENROUTER_API_KEY = prevKey;
});
