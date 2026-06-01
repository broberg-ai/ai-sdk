import { expect, test } from "bun:test";
import { noopSink, multiSink } from "./index.js";
import { createAI } from "../../client.js";
import { BudgetExceededError } from "../budget.js";
import type { CostSink, Usage } from "../../types.js";

const fakeUsage = (): Usage => ({
  provider: "anthropic",
  model: "claude-haiku-4-5",
  transport: "http",
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0.0001,
  latencyMs: 5,
  capability: "chat",
  ts: "2026-06-02T00:00:00.000Z",
});

test("noopSink.record does nothing and does not throw", () => {
  expect(noopSink.record(fakeUsage())).toBeUndefined();
});

test("multiSink fans out to all sinks", async () => {
  const a: Usage[] = [];
  const b: Usage[] = [];
  const sink = multiSink([
    { record: (u) => void a.push(u) },
    { record: (u) => void b.push(u) },
  ]);
  await sink.record(fakeUsage());
  expect(a).toHaveLength(1);
  expect(b).toHaveLength(1);
});

test("multiSink: one throwing sink does not stop the others", async () => {
  const ok: Usage[] = [];
  const sink = multiSink([
    { record: () => { throw new Error("sink down"); } },
    { record: (u) => void ok.push(u) },
  ]);
  await expect(sink.record(fakeUsage())).resolves.toBeUndefined();
  expect(ok).toHaveLength(1);
});

test("sink is called after a successful capability call", async () => {
  const seen: Usage[] = [];
  const sink: CostSink = { record: (u) => void seen.push(u) };
  const ai = createAI({ costSink: sink });
  await ai.chat({ prompt: "hi" });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.capability).toBe("chat");
});

test("sink is NOT called when a BudgetExceededError is thrown pre-flight", async () => {
  const seen: Usage[] = [];
  const sink: CostSink = { record: (u) => void seen.push(u) };
  const ai = createAI({ costSink: sink, budget: { perCallUsd: 0.0000001 } });
  await expect(ai.chat({ prompt: "x".repeat(400) })).rejects.toThrow(BudgetExceededError);
  expect(seen).toHaveLength(0);
});
