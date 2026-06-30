import { expect, test, afterEach } from "bun:test";
import { deepseekAdapter } from "./deepseek.js";
import { computeCost } from "../cost/usage.js";

const realFetch = globalThis.fetch;
const realKey = process.env.DEEPSEEK_API_KEY;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = realKey;
});

function mockFetch(response: unknown, status = 200) {
  const seen: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: (init!.headers ?? {}) as Record<string, string>, body: JSON.parse(init!.body as string) });
    return new Response(JSON.stringify(response), { status });
  }) as unknown as typeof fetch;
  return seen;
}

test("deepseekAdapter satisfies ProviderAdapter", () => {
  expect(deepseekAdapter({ apiKey: "k" }).name).toBe("deepseek");
});

test("posts to api.deepseek.com with Bearer auth + model slug passthrough", async () => {
  const seen = mockFetch({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
  const a = deepseekAdapter({ apiKey: "ds-key" });
  const res = await a.chat!({
    messages: [{ role: "user", content: "hi" }],
    spec: { provider: "deepseek", model: "deepseek-chat", transport: "http" },
  });
  expect(seen[0]?.url).toBe("https://api.deepseek.com/v1/chat/completions");
  expect(seen[0]?.headers["Authorization"]).toBe("Bearer ds-key");
  expect((seen[0]?.body as { model: string }).model).toBe("deepseek-chat");
  expect(res.usage.provider).toBe("deepseek");
  expect(res.usage.inputTokens).toBe(5);
});

test("key resolves from DEEPSEEK_API_KEY env; ship-dark throw without it", async () => {
  process.env.DEEPSEEK_API_KEY = "env-key";
  const seen = mockFetch({ choices: [{ message: { content: "ok" } }], usage: {} });
  await deepseekAdapter().chat!({ messages: [{ role: "user", content: "hi" }], spec: { provider: "deepseek", model: "deepseek-chat", transport: "http" } });
  expect(seen[0]?.headers["Authorization"]).toBe("Bearer env-key");

  delete process.env.DEEPSEEK_API_KEY;
  await expect(
    deepseekAdapter().chat!({ messages: [{ role: "user", content: "hi" }], spec: { provider: "deepseek", model: "deepseek-chat", transport: "http" } }),
  ).rejects.toThrow(/DEEPSEEK_API_KEY/);
});

test("direct DeepSeek models are priced from the table (no response cost field)", () => {
  // $0.14/$0.28 per 1M → 1M in + 1M out = $0.42
  expect(computeCost("deepseek", "deepseek-chat", 1_000_000, 1_000_000)).toBeCloseTo(0.42, 6);
  expect(computeCost("deepseek", "deepseek-reasoner", 1_000_000, 1_000_000)).toBeCloseTo(0.42, 6);
});
