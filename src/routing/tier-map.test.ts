import { expect, test } from "bun:test";
import { DEFAULT_TIER_MAP, resolveTier } from "./tier-map.js";
import type { Tier, TierSpec } from "../types.js";

test("DEFAULT_TIER_MAP covers all 6 tiers", () => {
  const tiers: Tier[] = ["fast", "smart", "powerful", "cheap", "vision", "embedding"];
  for (const t of tiers) expect(DEFAULT_TIER_MAP[t]).toBeDefined();
});

test("cheap tier defaults to the cheapest GDPR-safe cloud model over HTTP (claude -p retired)", () => {
  expect(DEFAULT_TIER_MAP.cheap).toEqual({ provider: "mistral", model: "mistral-small-latest", transport: "http" });
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

test("F030: NO default tier resolves to Anthropic (ANTHROPIC_API_KEY removed)", () => {
  for (const [tier, spec] of Object.entries(DEFAULT_TIER_MAP)) {
    expect(spec.provider, `tier "${tier}" must not default to anthropic`).not.toBe("anthropic");
  }
});

test("F030: the former Anthropic tiers now default to Mistral EU", () => {
  expect(DEFAULT_TIER_MAP.fast).toEqual({ provider: "mistral", model: "mistral-small-latest", transport: "http" });
  expect(DEFAULT_TIER_MAP.smart).toEqual({ provider: "mistral", model: "mistral-large-latest", transport: "http" });
  expect(DEFAULT_TIER_MAP.powerful).toEqual({ provider: "mistral", model: "mistral-large-latest", transport: "http" });
  // F041: vision moved off small — measured, see the comment in tier-map.ts.
  expect(DEFAULT_TIER_MAP.vision).toEqual({ provider: "mistral", model: "mistral-medium-latest", transport: "http" });
});

// F043 — a provider-only override used to carry the TIER's model to the new provider.
test("override with a provider but no model is REFUSED, not silently mismatched", () => {
  // The measured failure: tier "cheap" → mistral-small-latest, posted to Anthropic.
  expect(() => resolveTier("cheap", { provider: "anthropic" })).toThrow(/belongs to "mistral"/);
  // The error must name the fix, not just the problem.
  expect(() => resolveTier("cheap", { provider: "anthropic" })).toThrow(/Set a model too/);
});

test("provider + model together is allowed — that is the supported escape hatch", () => {
  const spec = resolveTier("cheap", { provider: "anthropic", model: "claude-haiku-4-5" });
  expect(spec.provider).toBe("anthropic");
  expect(spec.model).toBe("claude-haiku-4-5");
});

test("an override naming the SAME provider needs no model", () => {
  // Nothing is mismatched here, so refusing would break a legitimate call.
  const spec = resolveTier("cheap", { provider: "mistral" });
  expect(spec.provider).toBe("mistral");
  expect(spec.model).toBe(DEFAULT_TIER_MAP.cheap.model);
});

test("a model-only override still works (same provider, different model)", () => {
  const spec = resolveTier("cheap", { model: "mistral-large-latest" });
  expect(spec.provider).toBe("mistral");
  expect(spec.model).toBe("mistral-large-latest");
});

test("an inherited Object key steps aside for the registry, like any unknown provider", () => {
  // providers["constructor"] returns Object.prototype.constructor — truthy — so the
  // client's "no adapter registered" guard used to be skipped and the caller got a
  // confusing "does not support chat" instead. Found in security review of F043.
  // Here: given the real provider list, "constructor" is NOT one of them, so the
  // mismatch guard defers and lets the registry produce the useful error.
  const known = ["mistral", "anthropic", "openai"];
  expect(() => resolveTier("cheap", { provider: "constructor" }, undefined, known)).not.toThrow();
  expect(() => resolveTier("cheap", { provider: "anthropic" }, undefined, known)).toThrow(/belongs to "mistral"/);
});
