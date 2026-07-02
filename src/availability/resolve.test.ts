import { expect, test, beforeEach, afterEach } from "bun:test";
import { resolveModel, listModels } from "./resolve.js";
import { resetRegistry } from "./registry.js";
import { ModelUnavailableError } from "./types.js";

beforeEach(() => resetRegistry());

// ── AC1: transparent fallback, no throw ─────────────────────────────────────
test("suspended model + fallback → transparent swap (ok:false, fellBack:true)", () => {
  const r = resolveModel("claude-mythos-5", { fallback: "claude-opus-4-8" });
  expect(r.ok).toBe(false);
  expect(r.fellBack).toBe(true);
  expect(r.model).toBe("claude-opus-4-8");
  expect(r.requested).toBe("claude-mythos-5");
  expect(r.status).toBe("suspended");
  expect(r.reason).toContain("export-control");
});

test("fallback chain → first AVAILABLE wins (skips a suspended fallback)", () => {
  const r = resolveModel("mythos", { fallback: ["fable", "opus"] });
  expect(r.model).toBe("claude-fable-5"); // mythos suspended → skipped, fable available
  expect(r.fellBack).toBe(true);
});

// ── AC2: structured throw ───────────────────────────────────────────────────
test("suspended model + throwIfUnavailable → ModelUnavailableError", () => {
  try {
    resolveModel("claude-mythos-5", { throwIfUnavailable: true });
    throw new Error("should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(ModelUnavailableError);
    const err = e as ModelUnavailableError;
    expect(err.code).toBe("model_unavailable");
    expect(err.requested).toBe("claude-mythos-5");
    expect(err.note).toContain("export-control");
  }
});

test("available model (fable-5) returns ok:true, no fallback needed", () => {
  const r = resolveModel("claude-fable-5");
  expect(r.ok).toBe(true);
  expect(r.fellBack).toBe(false);
  expect(r.model).toBe("claude-fable-5");
  expect(r.status).toBe("available");
});

// ── AC3: alias-aware ────────────────────────────────────────────────────────
test("alias resolves identically to the canonical id (fable-5 available)", () => {
  const byAlias = resolveModel("fable");
  const byId = resolveModel("claude-fable-5");
  expect(byAlias.requested).toBe("claude-fable-5"); // normalized
  expect(byAlias.model).toBe("claude-fable-5");
  expect(byAlias.ok).toBe(byId.ok);
  expect(byAlias.ok).toBe(true); // fable-5 is now available
});

// ── AC4: zero false positives on live models ────────────────────────────────
test("known-live model → ok:true, fellBack:false, pass-through", () => {
  const r = resolveModel("claude-opus-4-8");
  expect(r.ok).toBe(true);
  expect(r.fellBack).toBe(false);
  expect(r.model).toBe("claude-opus-4-8");
  expect(r.status).toBe("available");
});

test("unknown/untracked id → fail-open (ok:true, status unknown)", () => {
  const r = resolveModel("some-new-model-we-dont-track");
  expect(r.ok).toBe(true);
  expect(r.fellBack).toBe(false);
  expect(r.status).toBe("unknown");
});

// ── AC5: zero network I/O on the hot path (spawn contract, cardmem #4842) ────
test("resolveModel + listModels do zero I/O (fetch throws → still return)", () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("hot path must not touch the network");
  }) as unknown as typeof fetch;
  try {
    expect(resolveModel("claude-mythos-5", { fallback: "claude-opus-4-8" }).model).toBe("claude-opus-4-8");
    expect(listModels().length).toBeGreaterThan(0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("resolveModel + listModels are synchronous (return a value, not a Promise)", () => {
  expect(resolveModel("opus")).not.toBeInstanceOf(Promise);
  expect(listModels()).not.toBeInstanceOf(Promise);
  expect(Array.isArray(listModels())).toBe(true);
});

afterEach(() => resetRegistry());
