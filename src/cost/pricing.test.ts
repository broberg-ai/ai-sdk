import { expect, test } from "bun:test";
import { getPrice } from "./pricing.js";
import { computeCost } from "./usage.js";
import { DEFAULT_TIER_MAP } from "../routing/tier-map.js";

test("pricing covers every model in DEFAULT_TIER_MAP", () => {
  for (const spec of Object.values(DEFAULT_TIER_MAP)) {
    expect(getPrice(spec.provider, spec.model)).toBeDefined();
  }
});

test("MiniMax M2.7 is priced via openrouter", () => {
  expect(getPrice("openrouter", "minimax/minimax-m2.7")).toBeDefined();
});

test("gemini-direct is priced under provider 'gemini' (not 'google')", () => {
  // The gemini adapter stamps usage.provider = "gemini"; the pricing key must
  // match or every gemini-direct call silently logs $0. Regression: was keyed
  // "google:" → getPrice("gemini", …) missed → cost under-counted.
  expect(getPrice("gemini", "gemini-2.5-flash")).toBeDefined();
  expect(computeCost("gemini", "gemini-2.5-flash", 1000, 500)).toBeCloseTo(0.00155, 9);
});

test("computeCost — sonnet 1M in + 1M out = $18.00", () => {
  expect(computeCost("anthropic", "claude-sonnet-4-6", 1_000_000, 1_000_000)).toBeCloseTo(
    18.0,
    6,
  );
});

test("computeCost — haiku 1000 in + 500 out = $0.0028", () => {
  expect(computeCost("anthropic", "claude-haiku-4-5", 1000, 500)).toBeCloseTo(0.0028, 9);
});

test("computeCost — gpt-4o-mini 2000 in + 1000 out = $0.0009", () => {
  expect(computeCost("openai", "gpt-4o-mini", 2000, 1000)).toBeCloseTo(0.0009, 9);
});

test("computeCost — embedding 1M input = $0.02 (no output)", () => {
  expect(computeCost("openai", "text-embedding-3-small", 1_000_000, 0)).toBeCloseTo(0.02, 6);
});

test("computeCost — anthropic cache-read priced below input rate", () => {
  // sonnet: 1M cache-read tokens @ 0.3/1M = $0.30 (vs $3.00 at input rate)
  expect(computeCost("anthropic", "claude-sonnet-4-6", 0, 0, 1_000_000, 0)).toBeCloseTo(0.3, 6);
});

test("computeCost returns 0 for an unknown model (never throws)", () => {
  expect(computeCost("acme", "does-not-exist", 1000, 1000)).toBe(0);
});

test("every pricing entry carries a version", () => {
  const spec = DEFAULT_TIER_MAP.smart;
  expect(getPrice(spec.provider, spec.model)?.version).toBeString();
});
