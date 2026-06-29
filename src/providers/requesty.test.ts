import { expect, test, afterEach } from "bun:test";
import { requestyAdapter } from "./requesty.js";

const realFetch = globalThis.fetch;
const realKey = process.env.REQUESTY_API_KEY;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.REQUESTY_API_KEY;
  else process.env.REQUESTY_API_KEY = realKey;
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

test("requestyAdapter satisfies ProviderAdapter", () => {
  expect(requestyAdapter({ apiKey: "k" }).name).toBe("requesty");
});

test("US default: posts to router.requesty.ai with Bearer auth + slug passthrough + ground-truth cost", async () => {
  const seen = mockFetch({
    choices: [{ message: { content: "ok" } }],
    usage: { prompt_tokens: 13, completion_tokens: 17, cost: 0.0000935 },
  });
  const a = requestyAdapter({ apiKey: "rq-key" });
  const res = await a.chat!({
    messages: [{ role: "user", content: "hi" }],
    spec: { provider: "requesty", model: "openai/gpt-4o", transport: "http" },
  });
  expect(seen[0]?.url).toBe("https://router.requesty.ai/v1/chat/completions");
  expect(seen[0]?.headers["Authorization"]).toBe("Bearer rq-key");
  expect((seen[0]?.body as { model: string }).model).toBe("openai/gpt-4o");
  // include:true requests the ground-truth cost; it lands as costUsd (not the estimate)
  expect((seen[0]?.body as { usage?: { include?: boolean } }).usage?.include).toBe(true);
  expect(res.text).toBe("ok");
  expect(res.usage.provider).toBe("requesty");
  expect(res.usage.costUsd).toBeCloseTo(0.0000935, 9);
});

test("eu:true routes to the EU data-residency endpoint", async () => {
  const seen = mockFetch({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const a = requestyAdapter({ apiKey: "k", eu: true });
  await a.chat!({
    messages: [{ role: "user", content: "hi" }],
    spec: { provider: "requesty", model: "mistral/mistral-large@eu-central-1", transport: "http" },
  });
  expect(seen[0]?.url).toBe("https://router.eu.requesty.ai/v1/chat/completions");
});

test("explicit baseUrl overrides eu/default", async () => {
  const seen = mockFetch({ choices: [{ message: { content: "ok" } }], usage: {} });
  const a = requestyAdapter({ apiKey: "k", baseUrl: "https://proxy.internal/v1" });
  await a.chat!({ messages: [{ role: "user", content: "hi" }], spec: { provider: "requesty", model: "openai/gpt-4o", transport: "http" } });
  expect(seen[0]?.url).toBe("https://proxy.internal/v1/chat/completions");
});

test("key resolves from REQUESTY_API_KEY env when not passed", async () => {
  process.env.REQUESTY_API_KEY = "env-key";
  const seen = mockFetch({ choices: [{ message: { content: "ok" } }], usage: {} });
  await requestyAdapter().chat!({ messages: [{ role: "user", content: "hi" }], spec: { provider: "requesty", model: "openai/gpt-4o", transport: "http" } });
  expect(seen[0]?.headers["Authorization"]).toBe("Bearer env-key");
});

test("ship-dark: no key + no env → clear throw only when called", async () => {
  delete process.env.REQUESTY_API_KEY;
  const a = requestyAdapter(); // no throw at construction
  await expect(
    a.chat!({ messages: [{ role: "user", content: "hi" }], spec: { provider: "requesty", model: "openai/gpt-4o", transport: "http" } }),
  ).rejects.toThrow(/REQUESTY_API_KEY/);
});
