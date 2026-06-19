// upmetricsCostClient — the cost READ-back side, companion to upmetricsSink (the
// write side). Upmetrics owns cost AGGREGATION (it already rolls up agent_runs):
// this is a thin, browser-clean wrapper over its public cost read-API
// (upmetrics/docs/COST-API.md, F014) so a consuming app reads its OWN accumulated
// cost from the canonical source instead of re-aggregating locally.
//
// Money is integer micro-USD ($1 = 1_000_000); Upmetrics rounds once at the
// response boundary so sub-cent calls aren't lost. Pure fetch, zero new deps, no
// bun:sqlite import → safe to import from a browser/Vite build.

/** Thrown when the cost read-API rejects (e.g. 401 invalid_api_key) or is unreachable. */
export class UpmetricsCostError extends Error {
  readonly status?: number;
  readonly code?: string;
  constructor(message: string, opts?: { status?: number; code?: string }) {
    super(message);
    this.name = "UpmetricsCostError";
    this.status = opts?.status;
    this.code = opts?.code;
  }
}

export interface UpmetricsCostClientConfig {
  /** Read-API base URL, e.g. https://upmetrics.org */
  baseUrl: string;
  /** Per-project api_key (uk_…) — sent as X-Upmetrics-Key; resolves to your own project only. */
  apiKey: string;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetch?: typeof fetch;
}

/** Shared filter surface for summary + timeseries (mirrors COST-API.md query params). */
export interface CostQuery {
  /** Relative window; ignored when from/to are given. */
  window?: "day" | "week" | "month";
  /** Explicit window start (ISO-8601 or epoch-ms) — overrides `window`. */
  from?: string | number;
  /** Explicit window end (ISO-8601 or epoch-ms) — overrides `window`. */
  to?: string | number;
  provider?: string;
  model?: string;
  tier?: string;
  /** Filter to one consumer (the sink's agent_name). */
  agentName?: string;
  transport?: "http" | "subprocess";
  /** Tag filters → `tag.<key>=<value>` (e.g. { tenantId: "sanne" }). */
  tags?: Record<string, string>;
}

export interface CostSummaryQuery extends CostQuery {
  /** Break the total down per distinct value of this tag key (the per-tenant view). */
  groupBy?: string;
}

export interface CostTimeseriesQuery extends CostQuery {
  /** Bucket granularity (default "day"). */
  bucket?: "day" | "hour";
}

/** One breakdown row, ordered by cost desc. `tier`/`capability` fall back to "(none)". */
export interface UpmetricsCostRow {
  key: string;
  micro_usd: number;
  input_tokens: number;
  output_tokens: number;
  run_count: number;
}

export interface UpmetricsCostSummary {
  generated_at: string;
  window: { from: string; to: string };
  total_micro_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  run_count: number;
  metered: { metered_micro_usd: number; free_run_count: number };
  by_provider: UpmetricsCostRow[];
  by_model: UpmetricsCostRow[];
  by_tier: UpmetricsCostRow[];
  by_capability: UpmetricsCostRow[];
  /** Present only when `groupBy` was requested. */
  group_by?: string;
  by_group?: UpmetricsCostRow[];
}

export interface UpmetricsCostTimeseries {
  generated_at: string;
  bucket: "day" | "hour";
  window: { from: string; to: string };
  /** Only non-zero buckets are returned — pad missing buckets yourself. */
  points: Array<{
    ts: string;
    micro_usd: number;
    input_tokens: number;
    output_tokens: number;
    run_count: number;
  }>;
}

/** Convert integer micro-USD to a USD float for display. `$1 = 1_000_000`. */
export const usdFromMicro = (microUsd: number): number => microUsd / 1_000_000;

function buildQuery(q: CostQuery & { groupBy?: string; bucket?: string }): string {
  const p = new URLSearchParams();
  if (q.bucket) p.set("bucket", q.bucket);
  if (q.from !== undefined) p.set("from", String(q.from));
  if (q.to !== undefined) p.set("to", String(q.to));
  // `window` is ignored server-side when from/to are present; only send it otherwise.
  if (q.window && q.from === undefined && q.to === undefined) p.set("window", q.window);
  if (q.provider) p.set("provider", q.provider);
  if (q.model) p.set("model", q.model);
  if (q.tier) p.set("tier", q.tier);
  if (q.agentName) p.set("agent_name", q.agentName);
  if (q.transport) p.set("transport", q.transport);
  if (q.groupBy) p.set("groupBy", q.groupBy);
  for (const [k, v] of Object.entries(q.tags ?? {})) p.set(`tag.${k}`, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function upmetricsCostClient(config: UpmetricsCostClientConfig): {
  summary(query?: CostSummaryQuery): Promise<UpmetricsCostSummary>;
  timeseries(query?: CostTimeseriesQuery): Promise<UpmetricsCostTimeseries>;
} {
  const doFetch = config.fetch ?? fetch;
  const base = config.baseUrl.replace(/\/$/, "");

  async function get<T>(path: string, query: string): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}${query}`, {
        method: "GET",
        headers: { "X-Upmetrics-Key": config.apiKey },
      });
    } catch (err) {
      throw new UpmetricsCostError(
        `upmetricsCostClient: ${path} unreachable: ${(err as Error)?.message ?? String(err)}`,
      );
    }
    if (!res.ok) {
      let code: string | undefined;
      const text = await res.text().catch(() => "");
      try {
        code = (JSON.parse(text) as { error?: string }).error;
      } catch {
        /* non-JSON error body */
      }
      throw new UpmetricsCostError(
        `upmetricsCostClient: ${path} returned ${res.status}${code ? ` (${code})` : ""}`,
        { status: res.status, code },
      );
    }
    return (await res.json()) as T;
  }

  return {
    summary(query: CostSummaryQuery = {}): Promise<UpmetricsCostSummary> {
      return get<UpmetricsCostSummary>("/api/cost/summary", buildQuery(query));
    },
    timeseries(query: CostTimeseriesQuery = {}): Promise<UpmetricsCostTimeseries> {
      return get<UpmetricsCostTimeseries>("/api/cost/timeseries", buildQuery(query));
    },
  };
}
