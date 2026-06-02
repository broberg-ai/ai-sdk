import { expect, test, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { BudgetGuard, BudgetExceededError } from "./budget.js";
import { sqliteBudgetStore } from "./budget-store.js";
import { createAI as realCreateAI } from "../client.js";
import { stubProviders } from "../providers/stub.js";
const createAI = (cfg: Parameters<typeof realCreateAI>[0] = {}) =>
  realCreateAI({ providers: stubProviders, ...cfg });

test("per-call ceiling: a single call over the limit throws", async () => {
  const g = new BudgetGuard({ perCallUsd: 0.001 });
  await expect(g.check(0.002)).rejects.toThrow(BudgetExceededError);
  await expect(g.check(0.0005)).resolves.toBeUndefined();
});

test("rolling ceiling accumulates: 3rd call over the limit throws, first two pass", async () => {
  const g = new BudgetGuard({ rollingUsd: 0.005 });
  await g.check(0.002);
  await g.record(0.002);
  await g.check(0.002);
  await g.record(0.002); // spent 0.004
  expect(await g.totalSpent()).toBeCloseTo(0.004, 9);
  await expect(g.check(0.002)).rejects.toThrow(BudgetExceededError); // 0.004 + 0.002 > 0.005
});

test("BudgetExceededError carries kind/limit/spent/requested", async () => {
  const g = new BudgetGuard({ rollingUsd: 0.005 });
  await g.record(0.004);
  try {
    await g.check(0.002);
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

const BUDGET_DB = "/tmp/ai-sdk-budget-test.db";
afterEach(() => {
  for (const f of [BUDGET_DB, `${BUDGET_DB}-wal`, `${BUDGET_DB}-shm`]) if (existsSync(f)) unlinkSync(f);
});

test("sqliteBudgetStore persists the rolling total across guard instances (survives 'restart')", async () => {
  for (const f of [BUDGET_DB, `${BUDGET_DB}-wal`, `${BUDGET_DB}-shm`]) if (existsSync(f)) unlinkSync(f);
  // First "process": spend 0.004 against a $0.005 rolling ceiling.
  const g1 = new BudgetGuard({ rollingUsd: 0.005, store: sqliteBudgetStore({ dbPath: BUDGET_DB }) });
  await g1.check(0.004);
  await g1.record(0.004);

  // Second "process" (new guard, same file) — sees the prior spend, blocks the next 0.002.
  const g2 = new BudgetGuard({ rollingUsd: 0.005, store: sqliteBudgetStore({ dbPath: BUDGET_DB }) });
  expect(await g2.totalSpent()).toBeCloseTo(0.004, 9);
  await expect(g2.check(0.002)).rejects.toThrow(BudgetExceededError);
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
