// Persistent BudgetStore backed by bun:sqlite (F7.1). The rolling total survives
// process restarts and is shared by every process pointing at the same file, so
// a budget ceiling is a real production guard — not a per-process counter that
// resets on deploy. bun:sqlite is imported lazily (Node-safe import, like sqliteSink).
import type { BudgetStore } from "../types.js";

export interface SqliteBudgetStoreConfig {
  /** SQLite file path, e.g. "./ai-budget.db". */
  dbPath: string;
  /** Window/bucket key — use e.g. a day-stamp for a daily budget. Default "default". */
  key?: string;
}

export function sqliteBudgetStore(config: SqliteBudgetStoreConfig): BudgetStore {
  const key = config.key ?? "default";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ready: Promise<any> | null = null;
  const open = async () => {
    const { Database } = await import("bun:sqlite");
    const db = new Database(config.dbPath);
    db.run(
      `CREATE TABLE IF NOT EXISTS budget_spend (key TEXT PRIMARY KEY, spent_usd REAL NOT NULL DEFAULT 0)`,
    );
    return db;
  };

  return {
    async getSpent(): Promise<number> {
      const db = await (ready ??= open());
      const row = db
        .query(`SELECT spent_usd FROM budget_spend WHERE key = $key`)
        .get({ $key: key }) as { spent_usd: number } | null;
      return row?.spent_usd ?? 0;
    },
    async addSpent(usd: number): Promise<void> {
      const db = await (ready ??= open());
      db.run(
        `INSERT INTO budget_spend (key, spent_usd) VALUES ($key, $usd)
         ON CONFLICT(key) DO UPDATE SET spent_usd = spent_usd + $usd`,
        { $key: key, $usd: usd },
      );
    },
  };
}
