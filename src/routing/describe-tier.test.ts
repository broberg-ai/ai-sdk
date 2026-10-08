import { expect, test } from "bun:test";
import { describeTier } from "./describe-tier.js";
import * as registry from "../registry.js";
import * as index from "../index.js";

test("describeTier('smart') names the pinned version and its price (F077.2)", () => {
  expect(describeTier("smart")).toEqual({
    tier: "smart", provider: "mistral", model: "mistral-large-2512", pinned: true,
    inputPer1M: 0.5, outputPer1M: 1.5, cacheReadPer1M: 0.05,
  });
  expect(describeTier("cheap")).toMatchObject({ model: "mistral-small-2603", pinned: true, inputPer1M: 0.15, outputPer1M: 0.6 });
});

test("every tier is pinned and priced", () => {
  for (const t of ["fast", "smart", "powerful", "cheap", "vision", "video", "embedding"] as const) {
    const d = describeTier(t);
    expect({ t, pinned: d.pinned, priced: d.inputPer1M !== undefined }).toEqual({ t, pinned: true, priced: true });
  }
});

test("exported from the package and from the browser-safe /registry entry", () => {
  expect(index.describeTier).toBe(describeTier);
  expect(registry.describeTier).toBe(describeTier);
});
