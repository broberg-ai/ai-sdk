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
  region: "us" as const,
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

test("creates the table and inserts one row per record (idempotent across sinks)", async () => {
  cleanup();
  const sink = sqliteSink({ dbPath: DB });
  await sink.record(usage());
  await sink.record(usage({ costUsd: 0.003 }));
  // a second sink on the same file must not fail (CREATE TABLE IF NOT EXISTS)
  const sink2 = sqliteSink({ dbPath: DB });
  await sink2.record(usage({ provider: "openai", capability: "embedding", costUsd: 0.001 }));

  const summary = await getCostSummary(DB);
  expect(summary.totalUsd).toBeCloseTo(0.006, 9);
});

test("getCostSummary aggregates by provider and capability", async () => {
  cleanup();
  const sink = sqliteSink({ dbPath: DB });
  await sink.record(usage({ provider: "anthropic", capability: "chat", costUsd: 0.01 }));
  await sink.record(usage({ provider: "anthropic", capability: "vision", costUsd: 0.02 }));
  await sink.record(usage({ provider: "openai", capability: "embedding", costUsd: 0.005 }));

  const s = await getCostSummary(DB);
  expect(s.totalUsd).toBeCloseTo(0.035, 9);
  expect(s.byProvider["anthropic"]).toBeCloseTo(0.03, 9);
  expect(s.byProvider["openai"]).toBeCloseTo(0.005, 9);
  expect(s.byCapability["chat"]).toBeCloseTo(0.01, 9);
  expect(s.byCapability["vision"]).toBeCloseTo(0.02, 9);
  expect(s.byCapability["embedding"]).toBeCloseTo(0.005, 9);
});

test("empty/unwritten DB summarises to zero total", async () => {
  cleanup();
  // getCostSummary creates the table if absent — a never-recorded DB → 0.
  const s = await getCostSummary(DB);
  expect(s.totalUsd).toBe(0);
  expect(s.byProvider).toEqual({});
});

test("an existing db from an earlier version gains the region column instead of failing", async () => {
  // The trap CREATE TABLE IF NOT EXISTS sets: it is a no-op on an existing table, so
  // without a migration every INSERT after this release would fail for anyone who
  // already had a cost db. Build the OLD schema by hand, then open the sink over it.
  const { Database } = await import("bun:sqlite");
  const path = `/tmp/ai-sdk-migrate-${Date.now()}.db`;
  const old = new Database(path);
  old.run(`CREATE TABLE ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, provider TEXT NOT NULL,
    model TEXT NOT NULL, tier TEXT, transport TEXT NOT NULL, capability TEXT NOT NULL,
    purpose TEXT, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL, cache_creation_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL, latency_ms INTEGER NOT NULL,
    subprocess INTEGER NOT NULL DEFAULT 0)`);
  old.run(`INSERT INTO ai_usage (ts,provider,model,transport,capability,input_tokens,
    output_tokens,cache_read_tokens,cache_creation_tokens,cost_usd,latency_ms)
    VALUES ('2026-01-01','mistral','m','http','chat',1,1,0,0,0.1,10)`);
  old.close();

  const sink = sqliteSink({ dbPath: path });
  await sink.record(usage({ region: "eu" }));

  // Read it BACK from a fresh connection — the sink's own opinion is what lies.
  const db = new Database(path, { readonly: true });
  const rows = db.query(`SELECT region FROM ai_usage ORDER BY id`).all() as { region: string }[];
  expect(rows.length).toBe(2);
  expect(rows[0]!.region).toBe("unknown"); // the pre-existing row, truthfully unknown
  expect(rows[1]!.region).toBe("eu");      // strict equality on what we wrote
  db.close();
});
