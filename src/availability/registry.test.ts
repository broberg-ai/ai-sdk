import { expect, test, beforeEach } from "bun:test";
import { resetRegistry, allEntries, canonicalId, getEntry, providerIds } from "./registry.js";
import { listModels } from "./resolve.js";

beforeEach(() => resetRegistry());

test("Fable 5 + Mythos 5 are seeded suspended with the export-control note", () => {
  const byId = new Map(listModels().map((m) => [m.id, m]));
  for (const id of ["claude-fable-5", "claude-mythos-5"]) {
    const m = byId.get(id)!;
    expect(m.available).toBe(false);
    expect(m.status).toBe("suspended");
    expect(m.note).toContain("export-control");
    expect(m.source).toBe("default");
  }
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
  expect(canonicalId("powerful")).toBe("claude-opus-4-8"); // second alias
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
