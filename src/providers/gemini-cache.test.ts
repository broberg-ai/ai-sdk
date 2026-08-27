// F040.1 — Gemini/Vertex implicit caching. Measured 2026-08-27: an 11,408-token
// repeated prefix reported promptTokenCount 11408 WITH cachedContentTokenCount
// 11242, so the prompt count INCLUDES the cached tokens.
import { describe, expect, test } from "bun:test";
import { splitCached } from "./gemini.js";
import { computeCost } from "../cost/usage.js";
import { PRICING } from "../cost/pricing.js";

describe("splitCached — the subtraction that prevents double-billing", () => {
  test("cached tokens are removed from inputTokens, matching the measured shape", () => {
    // The exact numbers from the live run.
    expect(splitCached({ promptTokenCount: 11408, cachedContentTokenCount: 11242 })).toEqual({
      inputTokens: 166,
      cacheReadTokens: 11242,
    });
  });

  test("the two halves still sum to what the provider reported", () => {
    const s = splitCached({ promptTokenCount: 11408, cachedContentTokenCount: 11242 });
    expect(s.inputTokens + (s.cacheReadTokens ?? 0)).toBe(11408);
  });

  test("an ABSENT cached field leaves the prompt count untouched", () => {
    // A cold call reports no cached field at all — that must not become 0-and-subtract,
    // and must not fabricate a cacheReadTokens the provider never sent.
    expect(splitCached({ promptTokenCount: 11407 })).toEqual({ inputTokens: 11407 });
  });

  test("undefined metadata is 0 input, not a crash", () => {
    expect(splitCached(undefined)).toEqual({ inputTokens: 0 });
  });

  test("never negative, even on an inconsistent provider response", () => {
    expect(splitCached({ promptTokenCount: 10, cachedContentTokenCount: 99 }).inputTokens).toBe(0);
  });
});

describe("cached Gemini tokens are billed at the published cached rate", () => {
  test("gemini and vertex rows carry 10% of their input rate, per ai.google.dev", () => {
    for (const key of [
      "gemini:gemini-2.5-flash",
      "gemini:gemini-2.5-flash-lite",
      "vertex:gemini-2.5-flash",
      "vertex:gemini-2.5-flash-lite",
    ]) {
      const p = PRICING[key]!;
      expect({ key, rate: p.cacheReadPer1M }).toEqual({
        key,
        rate: Number((p.inputPer1M * 0.1).toFixed(6)),
      });
      // The version string must name where the number came from, so a stale rate
      // is visible rather than assumed current.
      expect(p.version).toContain("ai.google.dev");
    }
  });

  test("the discount is real, computed rather than read from the table", () => {
    const uncached = computeCost("gemini", "gemini-2.5-flash", 11408, 5, 0);
    const cached = computeCost("gemini", "gemini-2.5-flash", 166, 5, 11242);
    expect(uncached).toBeCloseTo(11408 * 0.3e-6 + 5 * 2.5e-6, 12);
    expect(cached).toBeCloseTo(166 * 0.3e-6 + 11242 * 0.03e-6 + 5 * 2.5e-6, 12);
    expect(cached).toBeLessThan(uncached);
  });

  test("vertex is priced identically — the EU route to the same models", () => {
    expect(computeCost("vertex", "gemini-2.5-flash", 166, 5, 11242)).toBeCloseTo(
      computeCost("gemini", "gemini-2.5-flash", 166, 5, 11242),
      12,
    );
  });
});

describe("vertex reuses the same splitter — no second copy of the rule", () => {
  test("vertex.ts imports splitCached rather than restating the subtraction", async () => {
    const src = await Bun.file("src/providers/vertex.ts").text();
    expect(src).toContain("splitCached");
    // The raw pattern must NOT reappear: two copies of a subtraction rule is how
    // the tier map and the registry drifted for two months.
    expect(src).not.toContain("data.usageMetadata?.promptTokenCount ?? 0");
  });
});
