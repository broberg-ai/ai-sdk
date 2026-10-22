// F080.1 — every price row says what it is, how we reach it, and whether it still exists.
// The examples are the wrong answers "cheapest from X" gave on 22 Oct 2026.
import { expect, test } from "bun:test";
import { classifyKind, getModelPrice, listModelPrices } from "./pricing-api.js";

const row = (id: string) => {
  const p = getModelPrice(id);
  if (!p || p.unit !== "per_1m_tokens") throw new Error(`${id}: no token row`);
  return { kind: p.kind, route: p.route, batch: p.batch, upstream: p.upstream, callAs: p.callAs };
};

test("mistral rows: embedding, moderation and chat are told apart, and reached directly", () => {
  expect(row("mistral:mistral-embed")).toMatchObject({ kind: "embedding", route: "direct" });
  expect(row("mistral:mistral-moderation-2603")).toMatchObject({ kind: "moderation", route: "direct" });
  expect(row("mistral:mistral-small-2603")).toEqual({
    kind: "chat", route: "direct", batch: false, upstream: "listed", callAs: { provider: "mistral", model: "mistral-small-2603" },
  });
});

test("an OpenRouter-only model is route openrouter; a batch price is flagged", () => {
  expect(row("openai/gpt-oss-20b")).toMatchObject({ route: "openrouter", callAs: { provider: "openrouter", model: "openai/gpt-oss-20b" } });
  expect(row("anthropic/claude-haiku-5.5:batch")).toMatchObject({ batch: true });
  expect(row("anthropic/claude-haiku-5.5")).toMatchObject({ batch: false });
});

test("upstream: gone when the provider stopped listing it, unknown when we never asked", () => {
  // Reported gone by /model-research 17 Oct 2026.
  expect(row("mistral:mistral-moderation-latest").upstream).toBe("gone");
  // No direct DeepSeek list is fetched — "unknown", never "listed".
  expect(row("deepseek:deepseek-chat").upstream).toBe("unknown");
});

test("every token row carries all five fields", () => {
  for (const p of listModelPrices()) {
    expect(["direct", "openrouter"]).toContain(p.route);
    expect(["listed", "gone", "unknown"]).toContain(p.upstream);
    expect(typeof p.batch).toBe("boolean");
    expect(p.callAs.provider.length).toBeGreaterThan(0);
    expect(typeof p.kind).toBe("string");
  }
});

test("classifyKind", () => {
  expect([
    classifyKind("text-embedding-3-small"), classifyKind("whisper-1"), classifyKind("mistral-ocr-latest"),
    classifyKind("jev-1.13.0"), classifyKind("veo-3.1-generate-preview"), classifyKind("x/foo", "image"), classifyKind("mistral-large-2512"),
  ]).toEqual(["embedding", "transcribe", "ocr", "judge", "video", "image", "chat"]);
});
