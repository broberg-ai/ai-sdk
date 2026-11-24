// F095.1 — provider 'local': $0 embeddings on our own machines (Ollama, bge-m3).
import { afterEach, expect, test } from "bun:test";
import { createAI } from "../client.js";
import { localAdapter, LOCAL_EMBEDDING_DEFAULT_URL } from "./local.js";
import { openaiAdapter } from "./openai.js";
import { mistralAdapter } from "./mistral.js";

const LOCAL = { provider: "local", model: "bge-m3" } as const;
const vec = (n: number) => Array.from({ length: n }, (_, i) => i / n);
const saved = process.env.LOCAL_EMBEDDING_URL;
afterEach(() => { if (saved === undefined) delete process.env.LOCAL_EMBEDDING_URL; else process.env.LOCAL_EMBEDDING_URL = saved; });

function server(dims = 1024, status = 200) {
  const calls: { url: string; headers: Headers; body: any }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init!.headers), body: JSON.parse(String(init!.body)) });
    const input: string[] = JSON.parse(String(init!.body)).input;
    const body = status === 200
      ? { data: input.map(() => ({ embedding: vec(dims) })), usage: { prompt_tokens: 7 } }
      : { error: 'model "bge-m3" not found, try pulling it first' };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("F095 local route: /embeddings on the local server, no key sent, $0 known, provider local", async () => {
  delete process.env.LOCAL_EMBEDDING_URL;
  const { f, calls } = server();
  const ai = createAI({ costSink: null, providers: { local: localAdapter({ fetch: f }) } });
  const r = await ai.embedding({ text: ["hej verden", "hello world"], override: LOCAL });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe(`${LOCAL_EMBEDDING_DEFAULT_URL}/embeddings`);
  expect(calls[0]!.headers.get("authorization")).toBeNull();
  expect(calls[0]!.body).toEqual({ model: "bge-m3", input: ["hej verden", "hello world"] });
  expect(r.vectors).toHaveLength(2);
  expect(r.usage.provider).toBe("local");
  expect(r.usage.costUsd).toBe(0);
  expect(r.usage.costBasis).toBe("computed");
});

test("F095 LOCAL_EMBEDDING_URL picks the server (e.g. cb-ubuntu over the tailnet)", async () => {
  process.env.LOCAL_EMBEDDING_URL = "http://cb-ubuntu:11434/v1/";
  const { f, calls } = server();
  await createAI({ costSink: null, providers: { local: localAdapter({ fetch: f }) } }).embedding({ text: "x", override: LOCAL });
  expect(calls[0]!.url).toBe("http://cb-ubuntu:11434/v1/embeddings");
});

test("F095 every route carries model + dimensions — local, openai and mistral", async () => {
  const local = await createAI({ costSink: null, providers: { local: localAdapter({ fetch: server(1024).f }) } })
    .embedding({ text: "x", override: LOCAL });
  expect({ model: local.model, dimensions: local.dimensions }).toEqual({ model: "bge-m3", dimensions: 1024 });

  const openai = await createAI({ costSink: null, providers: { openai: openaiAdapter({ apiKey: "k", fetch: server(1536).f }) } })
    .embedding({ text: "x", override: { provider: "openai", model: "text-embedding-3-small" } });
  expect({ model: openai.model, dimensions: openai.dimensions }).toEqual({ model: "text-embedding-3-small", dimensions: 1536 });

  const mistral = await createAI({ costSink: null, providers: { mistral: mistralAdapter({ apiKey: "k", fetch: server(1024).f }) } })
    .embedding({ text: "x", override: { provider: "mistral", model: "mistral-embed" } });
  expect({ model: mistral.model, dimensions: mistral.dimensions }).toEqual({ model: "mistral-embed", dimensions: 1024 });
});

test("F095 ship dark: no local server → clear error naming the address, and NO other provider is called", async () => {
  const refused = (async () => { throw new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:11434"); }) as unknown as typeof fetch;
  const paid = server(1536);
  const ai = createAI({
    costSink: null,
    providers: { local: localAdapter({ baseUrl: "http://127.0.0.1:11434/v1", fetch: refused }), openai: openaiAdapter({ apiKey: "k", fetch: paid.f }) },
  });
  const msg = await ai.embedding({ text: "x", override: LOCAL }).then(() => "resolved", (e: Error) => e.message);
  expect(msg).toContain("local embedding server not reachable at http://127.0.0.1:11434/v1");
  expect(msg).toContain("Nothing was sent to any other provider");
  expect(paid.calls).toHaveLength(0);
});

test("F095 model not pulled → 404 says how to fetch it", async () => {
  const ai = createAI({ costSink: null, providers: { local: localAdapter({ fetch: server(1024, 404).f }) } });
  const msg = await ai.embedding({ text: "x", override: LOCAL }).then(() => "resolved", (e: Error) => e.message);
  expect(msg).toContain("ollama pull bge-m3");
});

test("F095 the default embedding tier did not move to local", async () => {
  const { ROUTED_SPECS } = await import("../client.js");
  expect(ROUTED_SPECS.some((s) => s.provider === "local")).toBe(false);
});
