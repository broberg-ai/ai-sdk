// upmetricsSink — the canonical cost sink. Forwards each Usage to the upmetrics
// agent-run ingest (POST /api/agent, mode:"record"). Field mapping follows
// upmetrics/docs/AGENT-SCHEMA.md "For cost-sink authors" exactly:
//   - agent_kind / agent_name are injected (not in Usage; required by ingest)
//   - camelCase Usage → snake_case wire fields
//   - capability + transport ride in tags (no top-level column)
//   - toolCalls[].errorCount → tool_calls[].error_count (deep rename)
//   - latencyMs → duration_ms; ts → started_at; ended_at = ts + latency
// Errors never propagate (CostSink invariant). Do NOT use @upmetrics/agent
// wrapAnthropic here — the SDK already owns the provider call.
import { randomUUID } from "node:crypto";
import { SDK_TAG } from "../../version.js";
import type { CostSink, Usage } from "../../types.js";

export interface UpmetricsSinkConfig {
  /** Ingest base URL, e.g. https://upmetrics.org */
  baseUrl: string;
  /** Per-project api_key → sent as the X-Upmetrics-Key header. */
  apiKey: string;
  /** Consumer name dashboards group by (e.g. "cms", "trail", "xrt81") — NOT the
   *  capability. */
  agentName: string;
  /** Defaults to "chatbot" ("embedding" auto-selected for embedding calls). */
  agentKind?: string;
  /** When true, guarantees no prompt/response content is ever sent (the sink
   *  sends none regardless — Usage carries no excerpts — so this is belt-and-
   *  suspenders for GDPR-health projects). */
  complianceMode?: boolean;
  /** Injectable fetch for testing; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Called when a record is actually LOST (dropped) or REFUSED (rejected) — not on a
   *  transient failure that is still being retried. See F061 below. */
  onError?: (err: unknown) => void;
  /** Retry transient failures in the background (F061). Default `true`.
   *
   *  SAFE ONLY IF THIS SINK'S RECEIVER DEDUPLICATES on `tags.idempotencyKey`. That is
   *  a property of your configuration, not of this package: upmetrics does (live since
   *  2026-09-08, measured by them — two deliveries of one payload → one row). If you
   *  point `baseUrl` at something that does not, a retry trades a loss for a double
   *  count there — set `retry: false`. We do not guess from the hostname: a sink that
   *  takes a baseUrl cannot have its behaviour decided by a name. */
  retry?: boolean;
  /** Base backoff in ms (doubles per attempt, capped at 30 s). For tests. */
  retryBaseMs?: number;
}

/** What the sink has done with what it was given — "we lost nothing" and "we do not
 *  know whether we lost anything" are different statements, and only a count can make
 *  the first one. In-process: it resets on deploy, so a zero is a claim about uptime,
 *  not about history (trail's caveat, and it is right). */
export interface UpmetricsSinkStats {
  /** Accepted by the receiver. */
  sent: number;
  /** Retry ATTEMPTS made (not records). */
  retried: number;
  /** Given up on: attempts exhausted, or pushed out of a full queue. LOST. */
  dropped: number;
  /** Permanently refused by the receiver (4xx other than 408/429). Not retried. */
  rejected: number;
  /** Waiting for a retry right now, including one in flight. */
  queued: number;
}

export interface UpmetricsSink extends CostSink {
  /** Try everything waiting, once, now. Call before exit in a SHORT-LIVED process
   *  (a script, a serverless function): the retry timer is unref'd so it never holds
   *  a process open, which also means it will not finish on its own before exit.
   *  Whatever still fails stays queued — check `stats().queued` afterwards. */
  flush(): Promise<void>;
  stats(): UpmetricsSinkStats;
}

/** F061 — a failed POST used to be one attempt and gone, with an optional hook as the
 *  only trace. Classification borrowed from upmetrics' own @upmetrics/sdk 0.5.1, INCLUDING
 *  the mistake they made first: they wrote `status >= 500` and would have discarded
 *  exactly the flood retry exists to catch. upmetrics' ingest answers 429 when a
 *  project hits its rolling per-minute ceiling — transient by construction, and it
 *  fires during a BURST, i.e. precisely when the records matter. 408 for the same
 *  reason. Their error was found by a Discovery check, not a test: the tests were green
 *  because they tested the rule as written. So ours is pinned from BOTH sides. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** The ceiling is not negotiable: an unbounded queue in a process that cannot reach
 *  its server IS a memory leak waiting for an outage. Same number upmetrics runs. */
const MAX_QUEUE = 30;
const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 30_000;

type Pending = { body: string; attempts: number };
type SendResult = { kind: "ok" } | { kind: "retry" | "reject"; err: unknown };

export function upmetricsSink(config: UpmetricsSinkConfig): UpmetricsSink {
  const doFetch = config.fetch ?? fetch;
  const url = `${config.baseUrl.replace(/\/$/, "")}/api/agent`;
  const retry = config.retry ?? true;
  const baseMs = config.retryBaseMs ?? 1000;

  const queue: Pending[] = [];
  const counts = { sent: 0, retried: 0, dropped: 0, rejected: 0 };
  let inFlight = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function buildBody(usage: Usage): string {
    const startedAt = usage.ts || new Date().toISOString();
    const endedAt = new Date(
      new Date(startedAt).getTime() + (usage.latencyMs || 0),
    ).toISOString();

    const agentKind =
      config.agentKind ?? (usage.capability === "embedding" ? "embedding" : "chatbot");

    const body: Record<string, unknown> = {
      mode: "record",
      agent_kind: agentKind,
      agent_name: config.agentName,
      provider: usage.provider,
      model: usage.model,
      status: "success",
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_tokens: usage.cacheReadTokens,
      cache_creation_tokens: usage.cacheCreationTokens,
      cost_usd: usage.costUsd,
      duration_ms: usage.latencyMs,
      started_at: startedAt,
      ended_at: endedAt,
      tags: {
        // Consumer attribution labels (e.g. tenantId) ride in tags so no new
        // top-level field risks the strict-shape ingest schema (F011). The
        // SDK-owned keys win — a label can never clobber capability/transport/sdk.
        ...usage.labels,
        capability: usage.capability,
        transport: usage.transport,
        // F042: data residency of the route that answered. Rides in tags like
        // capability/transport — no ingest-schema change, and without it the one
        // field built for auditability existed only in memory.
        region: usage.region,
        // F050: HOW cost_usd was arrived at. upmetrics already distinguishes
        // reported / computed / unpriced — we were sending an assumed number in
        // the same field as a measured one, so their labels could not be right
        // about our rows however carefully they were applied.
        cost_basis: usage.costBasis ?? "computed",
        sdk: SDK_TAG,
        // F061: the receiver's dedupe key. IDENTICAL across every retry of this record
        // — the body is built once and the same string is resent — and different
        // between records. Sent on the FIRST attempt too: a first attempt can reach the
        // server and lose its answer, and the retry must then dedupe against it. Placed
        // after the labels spread, so a consumer label cannot overwrite it.
        idempotencyKey: randomUUID(),
      },
    };
    if (usage.tier !== undefined) body.tier = usage.tier;
    if (usage.purpose !== undefined) body.purpose = usage.purpose;
    if (usage.toolCalls) {
      body.tool_calls = usage.toolCalls.map((t) => ({
        name: t.name,
        count: t.count,
        error_count: t.errorCount ?? 0,
      }));
    }
    // complianceMode is a no-op today (we never send excerpts) but documents intent.
    void config.complianceMode;
    return JSON.stringify(body);
  }

  async function send(body: string): Promise<SendResult> {
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Upmetrics-Key": config.apiKey,
        },
        body,
      });
      if (res.ok) return { kind: "ok" };
      const text = await res.text().catch(() => "");
      const err = new Error(`upmetricsSink: ingest returned ${res.status}: ${text.slice(0, 200)}`);
      return { kind: isRetryableStatus(res.status) ? "retry" : "reject", err };
    } catch (err) {
      // The request never got an answer — network, DNS, reset. Transient.
      return { kind: "retry", err };
    }
  }

  function lose(err: unknown): void {
    counts.dropped += 1;
    config.onError?.(err);
  }

  function enforceCap(): void {
    while (queue.length > MAX_QUEUE) {
      queue.shift();
      lose(new Error(`upmetricsSink: retry queue full (${MAX_QUEUE}) — dropped the oldest pending record`));
    }
  }

  /** Settle one retry attempt. Returns true when the record is still pending. */
  function settle(p: Pending, r: SendResult): boolean {
    if (r.kind === "ok") {
      counts.sent += 1;
      return false;
    }
    if (r.kind === "reject") {
      counts.rejected += 1;
      config.onError?.(r.err);
      return false;
    }
    if (p.attempts >= MAX_ATTEMPTS) {
      lose(r.err);
      return false;
    }
    return true;
  }

  function schedule(): void {
    if (timer || queue.length === 0) return;
    const head = queue[0]!;
    const delay = Math.min(baseMs * 2 ** (head.attempts - 1), MAX_BACKOFF_MS);
    timer = setTimeout(() => {
      timer = null;
      void drainOne();
    }, delay);
    // Never hold a process open for a cost record. The flip side is that a
    // short-lived process must call flush() — that is written on flush() itself.
    (timer as { unref?: () => void }).unref?.();
  }

  async function drainOne(): Promise<void> {
    // Taken OUT of the queue while in flight, so an overflow cannot drop a record
    // that is simultaneously being delivered and count it both lost and sent.
    const p = queue.shift();
    if (!p) return;
    inFlight += 1;
    p.attempts += 1;
    counts.retried += 1;
    const r = await send(p.body);
    inFlight -= 1;
    if (settle(p, r)) {
      queue.unshift(p);
      enforceCap();
    }
    schedule();
  }

  return {
    async record(usage: Usage): Promise<void> {
      // Never let a sink failure crash a real AI call (F3.3). And never let it DELAY
      // one either: client.ts awaits this on the call path, so a backoff in here would
      // add seconds to the user's AI call exactly when upmetrics is struggling. One
      // attempt now; everything after that happens in the background.
      try {
        const body = buildBody(usage);
        const r = await send(body);
        if (r.kind === "ok") {
          counts.sent += 1;
          return;
        }
        if (r.kind === "reject") {
          counts.rejected += 1;
          config.onError?.(r.err);
          return;
        }
        if (!retry) {
          lose(r.err);
          return;
        }
        queue.push({ body, attempts: 1 });
        enforceCap();
        schedule();
      } catch (err) {
        config.onError?.(err);
      }
    },

    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const batch = queue.splice(0);
      const stillPending: Pending[] = [];
      for (const p of batch) {
        inFlight += 1;
        p.attempts += 1;
        counts.retried += 1;
        const r = await send(p.body);
        inFlight -= 1;
        if (settle(p, r)) stillPending.push(p);
      }
      // Back at the FRONT, in their original order. Records that arrived DURING this
      // flush were pushed behind them, so the oldest still stands first — and the cap
      // drops from the front. Found in review: pushing these to the BACK put newer
      // records ahead of them, the cap then dropped new ones, and the error message
      // said "dropped the oldest" about a record that was not.
      queue.unshift(...stillPending);
      enforceCap();
      schedule();
    },

    stats(): UpmetricsSinkStats {
      return { ...counts, queued: queue.length + inFlight };
    },
  };
}
