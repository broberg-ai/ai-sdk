import { expect, test } from "bun:test";
import { getPrice } from "./pricing.js";
import { computeCost } from "./usage.js";

test("dated anthropic snapshot prices as its base model (F012)", () => {
  const base = getPrice("anthropic", "claude-haiku-4-5");
  const dated = getPrice("anthropic", "claude-haiku-4-5-20251001");
  expect(dated).toBeDefined();
  expect(dated).toEqual(base!);
});

test("dated openrouter slug normalizes to its base", () => {
  const base = getPrice("openrouter", "anthropic/claude-haiku-4-5");
  const dated = getPrice("openrouter", "anthropic/claude-haiku-4-5-20251001");
  expect(dated).toEqual(base!);
});

test("non-dated unknown model still returns undefined (no false match)", () => {
  expect(getPrice("anthropic", "claude-totally-made-up")).toBeUndefined();
  // a -YYYYMMDD suffix on an unknown base still misses
  expect(getPrice("anthropic", "claude-made-up-20251001")).toBeUndefined();
});

test("computeCost on a dated model is non-zero (no $0 under-count)", () => {
  // trail's case: real ~1800/1300 token translation on the dated haiku id
  const cost = computeCost("anthropic", "claude-haiku-4-5-20251001", 1800, 1300);
  expect(cost).toBeGreaterThan(0);
  // equals the base-model cost exactly
  expect(cost).toBe(computeCost("anthropic", "claude-haiku-4-5", 1800, 1300));
});
