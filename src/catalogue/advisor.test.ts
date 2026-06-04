import { expect, test } from "bun:test";
import { recommendModel } from "./advisor.js";
import type { Inventory, InventoryModel } from "./inventory.js";

function model(p: Partial<InventoryModel> & { model: string; provider: string }): InventoryModel {
  return {
    pricing: { unit: "per_1m_tokens" },
    inputModalities: ["text"],
    outputModalities: ["text"],
    categories: [],
    goodFor: [],
    source: "openrouter",
    ...p,
  };
}

const INV: Inventory = {
  generatedAt: "2026-06-01T00:00:00.000Z",
  modelCount: 5,
  models: [
    model({ provider: "mistralai", model: "mistralai/mistral-large-2512", region: "eu", gdprSafe: true, goodFor: ["frontier"], pricing: { unit: "per_1m_tokens", input: 0.5, output: 1.5 } }),
    model({ provider: "mistralai", model: "mistralai/voxtral-small", region: "eu", gdprSafe: true, inputModalities: ["audio", "text"], goodFor: ["audio", "transcription"], pricing: { unit: "per_1m_tokens", input: 0.1, output: 0.4 } }),
    model({ provider: "anthropic", model: "anthropic/claude-sonnet-4.6", region: "us", gdprSafe: false, goodFor: ["frontier", "reasoning"], pricing: { unit: "per_1m_tokens", input: 3, output: 15 } }),
    model({ provider: "openai", model: "openai/gpt-4o-mini", region: "us", gdprSafe: false, goodFor: ["fast"], pricing: { unit: "per_1m_tokens", input: 0.15, output: 0.6 } }),
    model({ provider: "deepseek", model: "deepseek/deepseek-chat", region: "cn", gdprSafe: false, goodFor: ["reasoning"], pricing: { unit: "per_1m_tokens", input: 0.3, output: 1.1 } }),
  ],
};
const NOW = Date.parse("2026-06-04T00:00:00.000Z"); // 3 days after generatedAt

test("GDPR-required excludes every US/CN model", () => {
  const r = recommendModel(INV, "chatbot on patient data", { gdprRequired: true }, NOW);
  expect(r.primary?.gdprSafe).toBe(true);
  expect(r.primary?.region).toBe("eu");
  // cheapest GDPR-safe output → voxtral ($0.4) over large ($1.5)
  expect(r.primary?.model).toBe("mistralai/voxtral-small");
  expect(r.matched).toBe(2);
});

test("GDPR + audio modality → the only EU audio model", () => {
  const r = recommendModel(INV, "transcribe voice notes", { gdprRequired: true, modality: "audio" }, NOW);
  expect(r.primary?.model).toBe("mistralai/voxtral-small");
  expect(r.matched).toBe(1);
});

test("prefer:frontier with GDPR → Mistral Large, not the cheaper Voxtral", () => {
  const r = recommendModel(INV, "best EU general model", { gdprRequired: true, prefer: "frontier" }, NOW);
  expect(r.primary?.model).toBe("mistralai/mistral-large-2512");
});

test("budget ceiling filters out expensive models", () => {
  const r = recommendModel(INV, "cheap chat", { maxOutputPer1M: 1.0 }, NOW);
  // outputs ≤ 1.0: voxtral 0.4, gpt-4o-mini 0.6 (deepseek 1.1, large 1.5, sonnet 15 excluded)
  expect(r.matched).toBe(2);
  expect(r.primary && r.primary.pricing.output! <= 1.0).toBe(true);
});

test("no match returns a helpful rationale, no primary", () => {
  const r = recommendModel(INV, "impossible", { gdprRequired: true, capability: "coding" }, NOW);
  expect(r.primary).toBeUndefined();
  expect(r.matched).toBe(0);
  expect(r.rationale).toContain("No model");
});

test("rationale cites price + region + inventory age; fresh at 3 days", () => {
  const r = recommendModel(INV, "x", { gdprRequired: true, prefer: "frontier" }, NOW);
  expect(r.inventoryAge).toContain("fresh");
  expect(r.rationale).toContain("mistralai/mistral-large-2512");
  expect(r.rationale).toContain("GDPR-safe");
});

test("stale inventory is flagged", () => {
  const old = Date.parse("2026-08-01T00:00:00.000Z"); // ~61 days later
  const r = recommendModel(INV, "x", {}, old);
  expect(r.inventoryAge).toContain("STALE");
});
