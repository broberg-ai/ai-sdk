import { expect, test } from "bun:test";
import { BudgetGuard, BudgetExceededError } from "./budget.js";
import { createAI } from "../client.js";

test("per-call ceiling: a single call over the limit throws", () => {
  const g = new BudgetGuard({ perCallUsd: 0.001 });
  expect(() => g.check(0.002)).toThrow(BudgetExceededError);
  expect(() => g.check(0.0005)).not.toThrow();
});

test("rolling ceiling accumulates: 3rd call over the limit throws, first two pass", () => {
  const g = new BudgetGuard({ rollingUsd: 0.005 });
  g.check(0.002);
  g.record(0.002);
  g.check(0.002);
  g.record(0.002); // spent 0.004
  expect(g.totalSpent).toBeCloseTo(0.004, 9);
  expect(() => g.check(0.002)).toThrow(BudgetExceededError); // 0.004 + 0.002 > 0.005
});

test("BudgetExceededError carries kind/limit/spent/requested", () => {
  const g = new BudgetGuard({ rollingUsd: 0.005 });
  g.record(0.004);
  try {
    g.check(0.002);
    throw new Error("should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(BudgetExceededError);
    const err = e as BudgetExceededError;
    expect(err.kind).toBe("rolling");
    expect(err.limit).toBe(0.005);
    expect(err.spent).toBeCloseTo(0.004, 9);
    expect(err.requested).toBe(0.002);
  }
});

test("no budget config → no guard (calls run freely)", async () => {
  const ai = createAI();
  const res = await ai.chat({ prompt: "no guard here" });
  expect(res.text).toContain("no guard here");
});

test("client blocks a call whose pre-flight estimate exceeds the per-call ceiling", async () => {
  // smart tier = anthropic/claude-sonnet-4-6 (3/15 per 1M). A ~512-output estimate
  // costs ~$0.0077, well over a $0.001 ceiling → throws before the adapter runs.
  const ai = createAI({ budget: { perCallUsd: 0.001 } });
  await expect(ai.chat({ prompt: "x".repeat(400) })).rejects.toThrow(BudgetExceededError);
});

test("client allows a call within a generous per-call ceiling", async () => {
  const ai = createAI({ budget: { perCallUsd: 1.0 } });
  const res = await ai.chat({ prompt: "cheap enough" });
  expect(res.text).toContain("cheap enough");
});
