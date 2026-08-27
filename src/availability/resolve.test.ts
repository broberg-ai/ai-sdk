import { describe, expect, test, beforeEach, afterEach } from "bun:test";
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

// F022.1 — requireKnown. Measured by cms: resolveModel("cheap") answered
// {ok:true, model:"cheap"}, so a consumer following our own instruction to gate
// on `ok` passed the gate and then sent the string "cheap" to a provider as a
// model id. A success-shaped non-answer is worse than an error.
describe("requireKnown — the gate can say 'I don't know this one'", () => {
  test("DEFAULT is unchanged: an untracked id is still fail-open", () => {
    const r = resolveModel("some-model-we-never-heard-of");
    expect(r.ok).toBe(true);
    expect(r.status).toBe("unknown");
  });

  test("requireKnown turns an untracked id into ok:false with a reason", () => {
    const r = resolveModel("smrt", { requireKnown: true });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("unknown");
    expect(r.reason).toContain("not a model this registry knows");
    expect(r.reason).toContain("requireKnown");
  });

  test("a KNOWN model is unaffected by requireKnown", () => {
    const r = resolveModel("claude-opus-4-8", { requireKnown: true });
    expect(r.ok).toBe(true);
    expect(r.model).toBe("claude-opus-4-8");
  });

  test("a known-but-suspended model still reports its own reason, not the unknown one", () => {
    const r = resolveModel("mythos", { requireKnown: true });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("suspended");
    expect(r.reason).not.toContain("requireKnown");
  });

  test("an untracked FALLBACK is refused too, not silently accepted", () => {
    const r = resolveModel("mythos", { fallback: "also-made-up", requireKnown: true });
    expect(r.fellBack).toBe(false);
    expect(r.ok).toBe(false);
  });

  test("a known fallback still rescues it", () => {
    const r = resolveModel("mythos", { fallback: "claude-opus-4-8", requireKnown: true });
    expect(r.fellBack).toBe(true);
    expect(r.model).toBe("claude-opus-4-8");
  });

  test("throwIfUnavailable + requireKnown throws, carrying the reason", () => {
    let caught: unknown;
    try {
      resolveModel("smrt", { requireKnown: true, throwIfUnavailable: true });
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ModelUnavailableError);
    expect((caught as Error).message).toContain("not a model this registry knows");
  });

  test("REGRESSION: an unknown model no longer claims status 'suspended'", () => {
    // It used to report status:"suspended" for a model it had never seen —
    // a confident diagnosis of something it knew nothing about.
    expect(resolveModel("smrt", { requireKnown: true }).status).toBe("unknown");
  });
});
