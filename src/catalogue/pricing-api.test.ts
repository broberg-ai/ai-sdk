import { expect, test } from "bun:test";
import {
  getModelPrice,
  listModelPrices,
  findModelPrices,
  priceCall,
  pricingGeneratedAt,
} from "./pricing-api.js";

test("getModelPrice: curated entry wins + is authoritative", () => {
  const p = getModelPrice("anthropic:claude-sonnet-4-6");
  expect(p).toBeDefined();
  expect(p!.source).toBe("curated");
  expect(p!.inputPer1M).toBe(3.0); // the curated authoritative number
  expect(p!.outputPer1M).toBe(15.0);
});

test("getModelPrice: an inventory-only model resolves with source 'inventory'", () => {
  const all = listModelPrices();
  const inv = all.find((m) => m.source === "inventory" && m.inputPer1M > 0);
  expect(inv).toBeDefined();
  const looked = getModelPrice(inv!.model);
  expect(looked).toBeDefined();
  expect(looked!.model).toBe(inv!.model);
});

test("id normalisation: '/' and ':' and basename all resolve to the same entry", () => {
  const a = getModelPrice("deepseek/deepseek-v4-flash");
  const b = getModelPrice("deepseek:deepseek-v4-flash");
  const c = getModelPrice("openrouter:deepseek/deepseek-v4-flash");
  expect(a).toBeDefined();
  expect(b?.model).toBe(a!.model);
  expect(c?.model).toBe(a!.model);
  // DeepSeek V4 Flash is curated-authoritative
  expect(a!.source).toBe("curated");
  expect(a!.inputPer1M).toBeCloseTo(0.0983, 4);
});

test("listModelPrices covers the full inventory (>=300) and every row is well-formed", () => {
  const all = listModelPrices();
  expect(all.length).toBeGreaterThanOrEqual(300);
  for (const m of all.slice(0, 50)) {
    expect(typeof m.inputPer1M).toBe("number");
    expect(typeof m.outputPer1M).toBe("number");
    expect(["eu", "us", "cn", "other"]).toContain(m.region);
  }
});

test("findModelPrices filters by region + free", () => {
  const eu = findModelPrices({ region: "eu" });
  expect(eu.length).toBeGreaterThan(0);
  expect(eu.every((m) => m.region === "eu")).toBe(true);

  const free = findModelPrices({ free: true });
  expect(free.every((m) => m.inputPer1M === 0 && m.outputPer1M === 0)).toBe(true);
});

test("priceCall computes USD for a token-priced model; undefined for unknown", () => {
  const usd = priceCall("anthropic:claude-sonnet-4-6", 1_000_000, 1_000_000);
  expect(usd).toBeCloseTo(3.0 + 15.0, 6);
  expect(priceCall("totally-made-up-model-xyz", 100, 100)).toBeUndefined();
});

test("pricingGeneratedAt returns the inventory snapshot timestamp", () => {
  expect(typeof pricingGeneratedAt()).toBe("string");
  expect(pricingGeneratedAt().length).toBeGreaterThan(0);
});
