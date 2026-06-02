import { expect, test, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { sqliteSink, getCostSummary } from "./sqlite.js";
import type { Usage } from "../../types.js";

const DB = "/tmp/ai-sdk-sqlite-test.db";

const cleanup = () => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) unlinkSync(f);
};
afterEach(cleanup);

const usage = (over: Partial<Usage> = {}): Usage => ({
  provider: "anthropic",
  model: "claude-haiku-4-5",
  tier: "fast",
  transport: "http",
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0.002,
  latencyMs: 300,
  capability: "chat",
  ts: "2026-06-02T00:00:00.000Z",
  ...over,
});

test("creates the table and inserts one row per record (idempotent across sinks)", () => {
  cleanup();
  const sink = sqliteSink({ dbPath: DB });
  sink.record(usage());
  sink.record(usage({ costUsd: 0.003 }));
  // a second sink on the same file must not fail (CREATE TABLE IF NOT EXISTS)
  const sink2 = sqliteSink({ dbPath: DB });
  sink2.record(usage({ provider: "openai", capability: "embedding", costUsd: 0.001 }));

  const summary = getCostSummary(DB);
  expect(summary.totalUsd).toBeCloseTo(0.006, 9);
});

test("getCostSummary aggregates by provider and capability", () => {
  cleanup();
  const sink = sqliteSink({ dbPath: DB });
  sink.record(usage({ provider: "anthropic", capability: "chat", costUsd: 0.01 }));
  sink.record(usage({ provider: "anthropic", capability: "vision", costUsd: 0.02 }));
  sink.record(usage({ provider: "openai", capability: "embedding", costUsd: 0.005 }));

  const s = getCostSummary(DB);
  expect(s.totalUsd).toBeCloseTo(0.035, 9);
  expect(s.byProvider["anthropic"]).toBeCloseTo(0.03, 9);
  expect(s.byProvider["openai"]).toBeCloseTo(0.005, 9);
  expect(s.byCapability["chat"]).toBeCloseTo(0.01, 9);
  expect(s.byCapability["vision"]).toBeCloseTo(0.02, 9);
  expect(s.byCapability["embedding"]).toBeCloseTo(0.005, 9);
});

test("empty DB summarises to zero total", () => {
  cleanup();
  sqliteSink({ dbPath: DB }); // creates the table, inserts nothing
  expect(getCostSummary(DB).totalUsd).toBe(0);
});
