import { describe, expect, test, beforeEach } from "bun:test";
import { resetRegistry, allEntries, canonicalId, getEntry, providerIds, TIER_ALIAS_CONFLICTS } from "./registry.js";
import { listModels } from "./resolve.js";
import { resolveModel } from "./resolve.js";
import { DEFAULT_TIER_MAP } from "../routing/tier-map.js";

beforeEach(() => resetRegistry());

test("Mythos 5 is seeded suspended with the export-control note (Fable 5 re-enabled)", () => {
  const byId = new Map(listModels().map((m) => [m.id, m]));
  // Fable 5 is now available (Anthropic restored it).
  const fable = byId.get("claude-fable-5")!;
  expect(fable.available).toBe(true);
  expect(fable.status).toBe("available");
  // Mythos 5 remains suspended (unverified).
  const mythos = byId.get("claude-mythos-5")!;
  expect(mythos.available).toBe(false);
  expect(mythos.status).toBe("suspended");
  expect(mythos.note).toContain("export-control");
  expect(mythos.source).toBe("default");
});

test("the tier-map defaults are seeded available (at least one available row)", () => {
  const opus = listModels().find((m) => m.id === "claude-opus-4-8")!;
  expect(opus.available).toBe(true);
  expect(opus.status).toBe("available");
  expect(listModels().some((m) => m.available)).toBe(true);
});

test("listModels exposes the first alias as ModelStatus.alias", () => {
  const fable = listModels().find((m) => m.id === "claude-fable-5")!;
  expect(fable.alias).toBe("fable");
});

test("listModels({ provider }) scopes the read", () => {
  const anthropic = listModels({ provider: "anthropic" });
  expect(anthropic.length).toBeGreaterThan(0);
  expect(anthropic.every((m) => m.provider === "anthropic")).toBe(true);
  expect(anthropic.some((m) => m.provider === "gemini")).toBe(false);
});

test("canonicalId resolves id and alias; unknown → null", () => {
  expect(canonicalId("claude-opus-4-8")).toBe("claude-opus-4-8");
  expect(canonicalId("opus")).toBe("claude-opus-4-8");
  // A TIER alias resolves to the model that tier actually calls. This line used
  // to assert "claude-opus-4-8" — the test ENCODED the drift, which is why three
  // months of it went unnoticed. A test that asserts the bug cannot report it.
  expect(canonicalId("powerful")).toBe("mistral-large-latest");
  expect(canonicalId("totally-made-up")).toBeNull();
});

test("getEntry returns the tracked row; untracked → undefined (fail-open signal)", () => {
  expect(getEntry("fable")?.id).toBe("claude-fable-5");
  expect(getEntry("totally-made-up")).toBeUndefined();
});

test("providerIds lists only that provider's tracked ids", () => {
  const ids = providerIds("anthropic");
  expect(ids).toContain("claude-fable-5");
  expect(ids).toContain("claude-opus-4-8");
  expect(ids).not.toContain("gemini-2.5-flash");
});

test("allEntries returns a fresh ModelStatus[] (registry not mutated by callers)", () => {
  const rows = allEntries();
  rows[0]!.available = !rows[0]!.available; // mutate the copy
  const reread = allEntries();
  expect(reread[0]!.available).not.toBe(rows[0]!.available); // original intact
});

// F030 drift guard — the registry and the router must never disagree about a
// tier again. They did for ~3 months, and the disagreement crossed the EU
// border: resolveModel('smart') named a US model while ai.chat({tier:'smart'})
// called an EU one. Found by fd-sundhed, who were about to display residency
// from the wrong one.
describe("resolveModel(tier) === the model that tier actually calls", () => {
  test("every tier resolves to its DEFAULT_TIER_MAP model and provider", () => {
    for (const [tier, spec] of Object.entries(DEFAULT_TIER_MAP)) {
      const r = resolveModel(tier);
      expect({ tier, model: r.model, provider: r.provider }).toEqual({
        tier,
        model: spec.model,
        provider: spec.provider,
      });
    }
  });

  test("no tier resolves to its own name — that means the alias is missing", () => {
    // resolveModel is fail-open, so an unknown tier returns the STRING BACK as
    // if it were a model id. That is what 'vision' and 'cheap' did: a picker
    // would have rendered the word "vision" as a model name.
    for (const tier of Object.keys(DEFAULT_TIER_MAP)) {
      expect(resolveModel(tier).model).not.toBe(tier);
      expect(resolveModel(tier).status).not.toBe("unknown");
    }
  });

  test("model-identity aliases still work — this did not break spawn lookups", () => {
    // buddy resolves Claude Code models by short name at spawn time.
    expect(resolveModel("opus").model).toBe("claude-opus-4-8");
    expect(resolveModel("sonnet").model).toBe("claude-sonnet-4-6");
    expect(resolveModel("haiku").model).toBe("claude-haiku-4-5");
    expect(resolveModel("fable").model).toBe("claude-fable-5");
    expect(resolveModel("mythos").ok).toBe(false);
    expect(resolveModel("mythos").status).toBe("suspended");
  });
});

test("no tier name is hand-declared on a row it does not belong to", () => {
  // The load-bearing half of the drift guard. Deriving the aliases makes runtime
  // correct; THIS makes a re-introduced hand-written alias visible instead of
  // being silently rescued by array order.
  expect(TIER_ALIAS_CONFLICTS).toEqual([]);
});
