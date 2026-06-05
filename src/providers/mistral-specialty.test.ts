import { expect, test } from "bun:test";
import { mistralAdapter } from "./mistral.js";
import { createAI } from "../client.js";

function jsonFetch(payload: unknown, status = 200) {
  const seen: { url: string; body: any }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    // JSON bodies parse; multipart (FormData, e.g. transcribe) passes through.
    const body = typeof init!.body === "string" ? JSON.parse(init!.body) : init!.body;
    seen.push({ url: String(url), body });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, seen };
}

const ocrSpec = { provider: "mistral", model: "mistral-ocr-latest", transport: "http" as const };
const modSpec = { provider: "mistral", model: "mistral-moderation-latest", transport: "http" as const };

test("ocr returns pages + per-page cost (3 pages × $0.002 = $0.006)", async () => {
  const { f } = jsonFetch({
    pages: [{ index: 0, markdown: "# Intake form" }, { index: 1, markdown: "page 2" }],
    usage_info: { pages_processed: 3 },
  });
  const adapter = mistralAdapter({ apiKey: "k", fetch: f });
  const { pages, usage } = await adapter.ocr!({ document: "https://example.com/doc.pdf", spec: ocrSpec });
  expect(pages).toEqual([{ index: 0, markdown: "# Intake form" }, { index: 1, markdown: "page 2" }]);
  expect(usage.capability).toBe("ocr");
  expect(usage.costUsd).toBeCloseTo(0.006, 9);
});

test("ocr routes image/* as image_url, else document_url", async () => {
  const img = jsonFetch({ pages: [], usage_info: { pages_processed: 1 } });
  await mistralAdapter({ apiKey: "k", fetch: img.f }).ocr!({ document: new Uint8Array([1, 2]), mimeType: "image/png", spec: ocrSpec });
  expect(img.seen[0]!.body.document.type).toBe("image_url");
  expect(img.seen[0]!.body.document.image_url).toStartWith("data:image/png;base64,");

  const doc = jsonFetch({ pages: [], usage_info: { pages_processed: 1 } });
  await mistralAdapter({ apiKey: "k", fetch: doc.f }).ocr!({ document: new Uint8Array([1, 2]), mimeType: "application/pdf", spec: ocrSpec });
  expect(doc.seen[0]!.body.document.type).toBe("document_url");
});

test("moderate flags any tripped category + prices per token", async () => {
  const { f } = jsonFetch({
    results: [
      { categories: { hate_and_discrimination: true, sexual: false }, category_scores: { hate_and_discrimination: 0.97, sexual: 0.01 } },
    ],
  });
  const adapter = mistralAdapter({ apiKey: "k", fetch: f });
  const { results, usage } = await adapter.moderate!({ input: ["some flagged client note"], spec: modSpec });
  expect(results[0]!.flagged).toBe(true);
  expect(results[0]!.categories.hate_and_discrimination).toBe(true);
  expect(results[0]!.categoryScores.hate_and_discrimination).toBeCloseTo(0.97, 6);
  expect(usage.capability).toBe("moderation");
  expect(usage.costUsd).toBeGreaterThan(0); // per-token, estimated from input length
});

test("moderate flagged=false when no category trips", async () => {
  const { f } = jsonFetch({ results: [{ categories: { hate: false, sexual: false }, category_scores: {} }] });
  const { results } = await mistralAdapter({ apiKey: "k", fetch: f }).moderate!({ input: ["hej, fin besked"], spec: modSpec });
  expect(results[0]!.flagged).toBe(false);
});

test("embedding posts {model,input} to /embeddings and returns vectors (F016.5)", async () => {
  const { f, seen } = jsonFetch({ data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }], usage: { prompt_tokens: 12 } });
  const adapter = mistralAdapter({ apiKey: "k", fetch: f });
  const { vectors, usage } = await adapter.embedding!({ input: ["a", "b"], spec: { provider: "mistral", model: "mistral-embed", transport: "http" } });
  expect(seen[0]!.url).toBe("https://api.mistral.ai/v1/embeddings");
  expect(seen[0]!.body).toEqual({ model: "mistral-embed", input: ["a", "b"] });
  expect(vectors).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
  expect(usage.capability).toBe("embedding");
  expect(usage.costUsd).toBeGreaterThan(0);
});

test("transcribe posts multipart to /audio/transcriptions, per-minute cost (F016.3)", async () => {
  const { f, seen } = jsonFetch({ text: "hello world" });
  const adapter = mistralAdapter({ apiKey: "k", fetch: f });
  const { text, usage } = await adapter.transcribe!({
    audio: new Uint8Array([1, 2, 3]),
    durationSec: 120,
    spec: { provider: "mistral", model: "voxtral-mini-latest", transport: "http" },
  });
  expect(seen[0]!.url).toBe("https://api.mistral.ai/v1/audio/transcriptions");
  expect(text).toBe("hello world");
  expect(usage.capability).toBe("transcribe");
  // 120s = 2 min × $0.002/min = $0.004
  expect(usage.costUsd).toBeCloseTo(0.004, 9);
});

test("ai.ocr + ai.moderate route to mistral by default (no override)", async () => {
  const ocrFetch = jsonFetch({ pages: [{ index: 0, markdown: "ok" }], usage_info: { pages_processed: 1 } });
  const aiOcr = createAI({ providers: { mistral: mistralAdapter({ apiKey: "k", fetch: ocrFetch.f }) } });
  const ocrRes = await aiOcr.ocr({ document: "https://x/y.pdf" });
  expect(ocrRes.pages[0]!.markdown).toBe("ok");
  expect(ocrFetch.seen[0]!.url).toBe("https://api.mistral.ai/v1/ocr");

  const modFetch = jsonFetch({ results: [{ categories: { hate: false }, category_scores: {} }] });
  const aiMod = createAI({ providers: { mistral: mistralAdapter({ apiKey: "k", fetch: modFetch.f }) } });
  const modRes = await aiMod.moderate({ input: "test" });
  expect(modRes.results[0]!.flagged).toBe(false);
  expect(modFetch.seen[0]!.url).toBe("https://api.mistral.ai/v1/moderations");
});
