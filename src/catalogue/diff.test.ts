import { expect, test } from "bun:test";
import { diffCatalogue } from "./diff.js";
import type { CatalogueModel } from "./types.js";

// All fixtures below are hand-built — the suite makes NO live network calls.

test("added — a tracked-brand direct model absent from PRICING is surfaced (the v0.5.1 $0-bug class)", () => {
  const fetched: CatalogueModel[] = [
    { provider: "gemini", model: "gemini-2.5-flash" }, // already priced → not added
    { provider: "gemini", model: "gemini-3-pro" }, // brand "gemini" tracked, not priced → added
    { provider: "anthropic", model: "claude-opus-4-8" }, // priced → not added
    { provider: "anthropic", model: "claude-sonnet-5-0" }, // tracked, not priced → added
    { provider: "openai", model: "dall-e-3" }, // brand "dall" not tracked → ignored
  ];
  const { added } = diffCatalogue(fetched, { fetchedProviders: ["gemini", "anthropic", "openai"] });
  const keys = added.map((m) => `${m.provider}:${m.model}`);
  expect(keys).toContain("gemini:gemini-3-pro");
  expect(keys).toContain("anthropic:claude-sonnet-5-0");
  expect(keys).not.toContain("gemini:gemini-2.5-flash"); // already priced
  expect(keys).not.toContain("openai:dall-e-3"); // untracked brand → not noise
});

test("missingPrice — every shipped DEFAULT_TIER_MAP route stays priced (healthy table = empty)", () => {
  // The hard regression guard: if a future tier-map edit points at an unpriced
  // model, this bucket goes non-empty and the cron flags it.
  const { missingPrice } = diffCatalogue([], { fetchedProviders: [] });
  expect(missingPrice).toEqual([]);
});

test("priceChanged — an OpenRouter price drift past the threshold is flagged", () => {
  const fetched: CatalogueModel[] = [
    { provider: "openrouter", model: "anthropic/claude-sonnet-4.6", inputPer1M: 3.0, outputPer1M: 15.0 }, // unchanged
    { provider: "openrouter", model: "anthropic/claude-haiku-4.5", inputPer1M: 0.8, outputPer1M: 4.0 }, // unchanged
    { provider: "openrouter", model: "google/gemini-2.5-flash", inputPer1M: 0.6, outputPer1M: 2.5 }, // input 0.3→0.6
  ];
  const { priceChanged } = diffCatalogue(fetched, { fetchedProviders: ["openrouter"] });
  const changed = priceChanged.find((p) => p.key === "openrouter:google/gemini-2.5-flash");
  expect(changed).toBeDefined();
  expect(changed?.upstreamInputPer1M).toBe(0.6);
  expect(changed?.ourInputPer1M).toBe(0.3);
  expect(priceChanged.map((p) => p.key)).not.toContain("openrouter:anthropic/claude-sonnet-4.6");
});

test("removedUpstream — a priced model no longer in a fetched provider's list is flagged", () => {
  const fetched: CatalogueModel[] = [
    { provider: "openrouter", model: "anthropic/claude-sonnet-4.6", inputPer1M: 3.0, outputPer1M: 15.0 },
    { provider: "openrouter", model: "anthropic/claude-haiku-4.5", inputPer1M: 0.8, outputPer1M: 4.0 },
    { provider: "openrouter", model: "google/gemini-2.5-flash", inputPer1M: 0.3, outputPer1M: 2.5 },
    // openrouter:minimax/minimax-m2.7 deliberately omitted
  ];
  const { removedUpstream } = diffCatalogue(fetched, { fetchedProviders: ["openrouter"] });
  expect(removedUpstream).toContain("openrouter:minimax/minimax-m2.7");
  expect(removedUpstream).not.toContain("openrouter:google/gemini-2.5-flash");
});

test("a provider we did NOT fetch is never judged as removed (failed fetch ≠ removal)", () => {
  // fetchedProviders omits openrouter → none of its priced keys may be flagged removed.
  const { removedUpstream } = diffCatalogue([], { fetchedProviders: ["gemini"] });
  expect(removedUpstream.some((k) => k.startsWith("openrouter:"))).toBe(false);
});

test("list-only direct models (no upstream price) never produce a false priceChanged", () => {
  const fetched: CatalogueModel[] = [
    { provider: "anthropic", model: "claude-haiku-4-5" }, // present, but no price field
    { provider: "anthropic", model: "claude-sonnet-4-6" },
    { provider: "anthropic", model: "claude-opus-4-8" },
  ];
  const { priceChanged } = diffCatalogue(fetched, { fetchedProviders: ["anthropic"] });
  expect(priceChanged).toEqual([]);
});
