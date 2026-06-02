// sqliteSink — persists every Usage to a local bun:sqlite DB. Secondary/offline
// sink (upmetricsSink is canonical). No npm dependency — bun:sqlite is built in.
//
// IMPORTANT: bun:sqlite is imported LAZILY (dynamic import on first use), not at
// module top level. A static `import "bun:sqlite"` would leak into the package
// entry and crash every Node consumer (`ERR_UNSUPPORTED_ESM_URL_SCHEME`). With
// the lazy import, importing @broberg/ai-sdk works everywhere; bun:sqlite only
// loads when sqliteSink/getCostSummary actually run (Bun only).
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function openDb(dbPath: string, readonly = false): Promise<any> {
  const { Database } = await import("bun:sqlite");
  return new Database(dbPath, readonly ? { readonly: true } : undefined);
}

export function sqliteSink(config: SqliteSinkConfig): CostSink {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ready: Promise<any> | null = null;
  const init = async () => {
    const db = await openDb(config.dbPath);
    db.run(CREATE_TABLE);
    const insert = db.prepare(
      `INSERT INTO ai_usage
         (ts, provider, model, tier, transport, capability, purpose,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          cost_usd, latency_ms, subprocess)
       VALUES ($ts, $provider, $model, $tier, $transport, $capability, $purpose,
          $input, $output, $cacheRead, $cacheCreation, $cost, $latency, $subprocess)`,
    );
    return insert;
  };

  return {
    async record(usage: Usage): Promise<void> {
      const insert = await (ready ??= init());
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

/** Aggregate the recorded spend from a sqliteSink DB. Creates the table if the
 *  DB has never been written to, so an empty DB summarises cleanly to 0. */
export async function getCostSummary(dbPath: string): Promise<CostSummary> {
  const db = await openDb(dbPath);
  db.run(CREATE_TABLE);
  const total = db
    .query(`SELECT SUM(cost_usd) AS total FROM ai_usage`)
    .get() as { total: number | null };
  const byProvider: Record<string, number> = {};
  for (const row of db
    .query(`SELECT provider, SUM(cost_usd) AS sum FROM ai_usage GROUP BY provider`)
    .all() as { provider: string; sum: number }[]) {
    byProvider[row.provider] = row.sum;
  }
  const byCapability: Record<string, number> = {};
  for (const row of db
    .query(`SELECT capability, SUM(cost_usd) AS sum FROM ai_usage GROUP BY capability`)
    .all() as { capability: string; sum: number }[]) {
    byCapability[row.capability] = row.sum;
  }
  return { totalUsd: total?.total ?? 0, byProvider, byCapability };
}
