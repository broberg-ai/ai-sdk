import { expect, test, afterEach } from "bun:test";
import { EMBEDDING_DEFAULT_TIER } from "./embedding.js";
import { openaiAdapter } from "../providers/openai.js";
import { createAI } from "../client.js";

const realFetch = globalThis.fetch;
const prevKey = process.env.OPENAI_API_KEY;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
});

function mockEmbeddings(n: number) {
  process.env.OPENAI_API_KEY = "sk-test";
  const seen: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(init!.body as string) });
    return new Response(
      JSON.stringify({
        data: Array.from({ length: n }, () => ({ embedding: [0.1, 0.2, 0.3] })),
        usage: { prompt_tokens: 7 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return seen;
}

test("EMBEDDING_DEFAULT_TIER is 'embedding'", () => {
  expect(EMBEDDING_DEFAULT_TIER).toBe("embedding");
});

test("openai adapter embedding(): POSTs /embeddings, one vector per input + usage", async () => {
  const seen = mockEmbeddings(2);
  const a = openaiAdapter({ apiKey: "k" });
  const res = await a.embedding!({
    input: ["a", "b"],
    spec: { provider: "openai", model: "text-embedding-3-small", transport: "http" },
  });
  expect(seen[0]?.url).toBe("https://api.openai.com/v1/embeddings");
  expect(seen[0]?.body.input).toEqual(["a", "b"]);
  expect(res.vectors).toHaveLength(2);
  expect(res.vectors[0]).toEqual([0.1, 0.2, 0.3]);
  expect(res.usage.inputTokens).toBe(7);
  expect(res.usage.capability).toBe("embedding");
});

test("ai.embedding({text:string}) → one vector via default embedding tier (openai)", async () => {
  mockEmbeddings(1);
  const ai = createAI(); // live registry → real openai embedding
  const res = await ai.embedding({ text: "hello" });
  expect(res.vectors).toHaveLength(1);
  expect(res.usage.provider).toBe("openai");
  expect(res.usage.tier).toBe("embedding");
  expect(res.usage.capability).toBe("embedding");
});

test("ai.embedding({text:string[]}) → one vector per input", async () => {
  mockEmbeddings(3);
  const ai = createAI();
  const res = await ai.embedding({ text: ["a", "b", "c"] });
  expect(res.vectors).toHaveLength(3);
});
