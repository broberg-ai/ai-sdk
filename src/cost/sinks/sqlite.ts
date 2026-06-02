// sqliteSink — persists every Usage to a local bun:sqlite DB. Secondary/offline
// sink (upmetricsSink is canonical). No npm dependency — bun:sqlite is built in.
import { Database } from "bun:sqlite";
import type { CostSink, Usage } from "../../types.js";

export interface SqliteSinkConfig {
  /** Path to the SQLite file, e.g. "./ai-cost.db" (or ":memory:"). */
  dbPath: string;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tier TEXT,
  transport TEXT NOT NULL,
  capability TEXT NOT NULL,
  purpose TEXT,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  latency_ms INTEGER NOT NULL,
  subprocess INTEGER NOT NULL DEFAULT 0
)`;

export function sqliteSink(config: SqliteSinkConfig): CostSink {
  const db = new Database(config.dbPath);
  db.run(CREATE_TABLE);
  const insert = db.prepare(
    `INSERT INTO ai_usage
       (ts, provider, model, tier, transport, capability, purpose,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        cost_usd, latency_ms, subprocess)
     VALUES ($ts, $provider, $model, $tier, $transport, $capability, $purpose,
        $input, $output, $cacheRead, $cacheCreation, $cost, $latency, $subprocess)`,
  );

  return {
    record(usage: Usage): void {
      insert.run({
        $ts: usage.ts || new Date().toISOString(),
        $provider: usage.provider,
        $model: usage.model,
        $tier: usage.tier ?? null,
        $transport: usage.transport,
        $capability: usage.capability,
        $purpose: usage.purpose ?? null,
        $input: usage.inputTokens,
        $output: usage.outputTokens,
        $cacheRead: usage.cacheReadTokens,
        $cacheCreation: usage.cacheCreationTokens,
        $cost: usage.costUsd,
        $latency: usage.latencyMs,
        $subprocess: usage.subprocess ? 1 : 0,
      });
    },
  };
}

export interface CostSummary {
  totalUsd: number;
  byProvider: Record<string, number>;
  byCapability: Record<string, number>;
}

/** Aggregate the recorded spend from a sqliteSink DB. */
export function getCostSummary(dbPath: string): CostSummary {
  const db = new Database(dbPath, { readonly: true });
  const total = db
    .query<{ total: number | null }, []>(`SELECT SUM(cost_usd) AS total FROM ai_usage`)
    .get();
  const byProvider: Record<string, number> = {};
  for (const row of db
    .query<{ provider: string; sum: number }, []>(
      `SELECT provider, SUM(cost_usd) AS sum FROM ai_usage GROUP BY provider`,
    )
    .all()) {
    byProvider[row.provider] = row.sum;
  }
  const byCapability: Record<string, number> = {};
  for (const row of db
    .query<{ capability: string; sum: number }, []>(
      `SELECT capability, SUM(cost_usd) AS sum FROM ai_usage GROUP BY capability`,
    )
    .all()) {
    byCapability[row.capability] = row.sum;
  }
  return { totalUsd: total?.total ?? 0, byProvider, byCapability };
}
