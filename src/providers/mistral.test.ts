import { expect, test, afterEach } from "bun:test";
import { mistralAdapter } from "./mistral.js";

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

test("mistralAdapter satisfies ProviderAdapter", () => {
  expect(mistralAdapter({ apiKey: "k" }).name).toBe("mistral");
});

test("posts to the Mistral chat endpoint with Bearer auth + prices the call", async () => {
  const seen = mockFetch({
    choices: [{ message: { content: "MISTRAL_OK" } }],
    usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
  });
  const a = mistralAdapter({ apiKey: "mk" });
  const res = await a.chat!({
    messages: [{ role: "user", content: "hi" }],
    spec: { provider: "mistral", model: "mistral-medium-3.5", transport: "http" },
  });
  expect(seen[0]?.url).toBe("https://api.mistral.ai/v1/chat/completions");
  expect(seen[0]?.headers["Authorization"]).toBe("Bearer mk");
  expect((seen[0]?.body as { model: string }).model).toBe("mistral-medium-3.5");
  expect(res.text).toBe("MISTRAL_OK");
  expect(res.usage.provider).toBe("mistral");
  // mistral-medium-3.5 = 1.5/1M in + 7.5/1M out → 1M+1M = $9.00 (not $0).
  expect(res.usage.costUsd).toBeCloseTo(9.0, 6);
});

test("registered in the default provider registry", async () => {
  const { defaultProviders } = await import("./registry.js");
  expect(defaultProviders.mistral?.name).toBe("mistral");
});
