import { expect, test } from "bun:test";
import { DEFAULT_TIER_MAP, resolveTier } from "./tier-map.js";
import type { Tier, TierSpec } from "../types.js";

test("DEFAULT_TIER_MAP covers all 6 tiers", () => {
  const tiers: Tier[] = ["fast", "smart", "powerful", "cheap", "vision", "embedding"];
  for (const t of tiers) expect(DEFAULT_TIER_MAP[t]).toBeDefined();
});

test("cheap tier routes through subprocess (Max plan, cost 0)", () => {
  expect(DEFAULT_TIER_MAP.cheap.transport).toBe("subprocess");
});

test("resolveTier returns the default when nothing overrides", () => {
  expect(resolveTier("fast")).toEqual(DEFAULT_TIER_MAP.fast);
});

test("per-call override wins over config map wins over default", () => {
  const configMap: Partial<Record<Tier, TierSpec>> = {
    smart: { provider: "openrouter", model: "anthropic/claude-sonnet-4-6", transport: "http" },
  };
  // config map alone replaces the default
  expect(resolveTier("smart", undefined, configMap).provider).toBe("openrouter");
  // per-call override beats the config map, field-by-field
  const resolved = resolveTier("smart", { model: "minimax/minimax-m2.7" }, configMap);
  expect(resolved.provider).toBe("openrouter"); // from config map
  expect(resolved.model).toBe("minimax/minimax-m2.7"); // from override
  expect(resolved.transport).toBe("http");
});

test("partial override only changes the fields it sets", () => {
  const resolved = resolveTier("fast", { transport: "subprocess" });
  expect(resolved.transport).toBe("subprocess");
  expect(resolved.provider).toBe(DEFAULT_TIER_MAP.fast.provider);
  expect(resolved.model).toBe(DEFAULT_TIER_MAP.fast.model);
});
