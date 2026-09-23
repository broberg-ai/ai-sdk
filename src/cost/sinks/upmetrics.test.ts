import { expect, test } from "bun:test";
import { upmetricsSink } from "./upmetrics.js";
import { SDK_TAG } from "../../version.js";
import type { Usage } from "../../types.js";

const usage = (over: Partial<Usage> = {}): Usage => ({
  provider: "anthropic",
  model: "claude-haiku-4-5",
  tier: "fast",
  region: "us" as const,
  transport: "http",
  inputTokens: 420,
  outputTokens: 180,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0.00009,
  latencyMs: 1200,
  capability: "translate",
  purpose: "ui-string-translation",
  ts: "2026-06-02T10:00:00.000Z",
  ...over,
});

function captureFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ run_id: "uuid-1" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("posts to /api/agent with the X-Upmetrics-Key header", async () => {
  const { calls, fetchImpl } = captureFetch();
  const sink = upmetricsSink({
    baseUrl: "https://upmetrics.org",
    apiKey: "k-123",
    agentName: "xrt81",
    fetch: fetchImpl,
  });
  await sink.record(usage());
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("https://upmetrics.org/api/agent");
  const headers = calls[0]?.init.headers as Record<string, string>;
  expect(headers["X-Upmetrics-Key"]).toBe("k-123");
});

test("maps Usage → snake_case wire body per AGENT-SCHEMA", async () => {
  const { calls, fetchImpl } = captureFetch();
  const sink = upmetricsSink({
    baseUrl: "https://upmetrics.org",
    apiKey: "k",
    agentName: "xrt81",
    fetch: fetchImpl,
  });
  await sink.record(
    usage({ toolCalls: [{ name: "Read", count: 5, errorCount: 1 }] }),
  );
  const body = JSON.parse(calls[0]?.init.body as string);
  expect(body.mode).toBe("record");
  expect(body.agent_name).toBe("xrt81");
  expect(body.agent_kind).toBe("chatbot");
  expect(body.input_tokens).toBe(420);
  expect(body.output_tokens).toBe(180);
  expect(body.cost_usd).toBeCloseTo(0.00009, 9);
  expect(body.duration_ms).toBe(1200);
  expect(body.tier).toBe("fast");
  expect(body.purpose).toBe("ui-string-translation");
  // capability + transport ride in tags; sdk tag carries the version
  expect(body.tags.capability).toBe("translate");
  expect(body.tags.transport).toBe("http");
  expect(body.tags.sdk).toBe(SDK_TAG);
  // deep rename errorCount → error_count
  expect(body.tool_calls[0]).toEqual({ name: "Read", count: 5, error_count: 1 });
  // ended_at = started_at + latency
  expect(body.started_at).toBe("2026-06-02T10:00:00.000Z");
  expect(body.ended_at).toBe("2026-06-02T10:00:01.200Z");
});

test("embedding capability auto-selects agent_kind 'embedding'", async () => {
  const { calls, fetchImpl } = captureFetch();
  const sink = upmetricsSink({
    baseUrl: "https://upmetrics.org",
    apiKey: "k",
    agentName: "trail",
    fetch: fetchImpl,
  });
  await sink.record(usage({ capability: "embedding" }));
  expect(JSON.parse(calls[0]?.init.body as string).agent_kind).toBe("embedding");
});

test("explicit agentKind overrides the default", async () => {
  const { calls, fetchImpl } = captureFetch();
  const sink = upmetricsSink({
    baseUrl: "https://upmetrics.org",
    apiKey: "k",
    agentName: "cms",
    agentKind: "cc",
    fetch: fetchImpl,
  });
  await sink.record(usage());
  expect(JSON.parse(calls[0]?.init.body as string).agent_kind).toBe("cc");
});

test("network failure is swallowed (never throws) and surfaces via onError — retry:false", async () => {
  // F061: with retry ON (the default) a network failure is not LOST yet — it is queued,
  // and onError fires only when a record is actually given up on. This test pins the
  // pre-F061 behaviour, which retry:false must still reproduce exactly.
  const errors: unknown[] = [];
  const failing = (async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;
  const sink = upmetricsSink({
    baseUrl: "https://upmetrics.org",
    apiKey: "k",
    agentName: "xrt81",
    fetch: failing,
    retry: false,
    onError: (e) => errors.push(e),
  });
  await expect(sink.record(usage())).resolves.toBeUndefined();
  expect(errors).toHaveLength(1);
});

test("non-2xx response surfaces via onError but does not throw", async () => {
  const errors: unknown[] = [];
  const bad = (async () =>
    new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 })) as unknown as typeof fetch;
  const sink = upmetricsSink({
    baseUrl: "https://upmetrics.org",
    apiKey: "k",
    agentName: "xrt81",
    fetch: bad,
    onError: (e) => errors.push(e),
  });
  await sink.record(usage());
  expect(errors).toHaveLength(1);
  expect(String(errors[0])).toContain("400");
});

// ── F061 — retry transient failures in the background ────────────────────────────
//
// Every test below drives the REAL send path through an injected fetch. trail's first
// retry test built its own sink with its own counter and passed while the engine's real
// counting had been removed; a test that owns its own bookkeeping proves the bookkeeping.

/** A fetch that answers from a script: a status code, or "throw" for a network error. */
function scriptedFetch(script: Array<number | "throw">) {
  const bodies: string[] = [];
  let i = 0;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    const step = script[Math.min(i++, script.length - 1)];
    if (step === "throw") throw new Error("ECONNRESET");
    return new Response("{}", { status: step as number });
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

const sinkWith = (fetchImpl: typeof fetch, over: Record<string, unknown> = {}) =>
  upmetricsSink({
    baseUrl: "https://upmetrics.org",
    apiKey: "k",
    agentName: "t",
    fetch: fetchImpl,
    retryBaseMs: 60_000, // the timer must not fire mid-test; flush() drives retries
    ...over,
  });

test("F061: each TRANSIENT failure is queued and delivered on retry", async () => {
  for (const first of ["throw", 408, 429, 500, 502, 503] as const) {
    const { bodies, fetchImpl } = scriptedFetch([first, 200]);
    const errors: unknown[] = [];
    const sink = sinkWith(fetchImpl, { onError: (e: unknown) => errors.push(e) });
    await sink.record(usage());
    expect({ first, queued: sink.stats().queued }).toEqual({ first, queued: 1 });
    await sink.flush();
    expect({ first, ...sink.stats() }).toEqual({ first, sent: 1, retried: 1, dropped: 0, rejected: 0, queued: 0 });
    expect(bodies).toHaveLength(2);
    // Recovered, so nothing was lost — and nothing should have been reported as lost.
    expect(errors).toHaveLength(0);
  }
});

test("F061: each PERMANENT refusal is not retried, counted rejected, and reported once", async () => {
  for (const status of [400, 401, 403, 404, 422]) {
    const { bodies, fetchImpl } = scriptedFetch([status]);
    const errors: unknown[] = [];
    const sink = sinkWith(fetchImpl, { onError: (e: unknown) => errors.push(e) });
    await sink.record(usage());
    await sink.flush();
    expect({ status, ...sink.stats() }).toEqual({ status, sent: 0, retried: 0, dropped: 0, rejected: 1, queued: 0 });
    expect(bodies).toHaveLength(1); // exactly one attempt
    expect(errors).toHaveLength(1);
  }
});

test("F061: record() never waits for a retry — one attempt against a down receiver, then return", async () => {
  // client.ts awaits the sink ON THE AI CALL'S PATH. If record() waited for a backoff,
  // every AI call would slow down precisely while upmetrics is struggling.
  const { bodies, fetchImpl } = scriptedFetch(["throw"]);
  const sink = sinkWith(fetchImpl);
  const t0 = performance.now();
  await sink.record(usage());
  const ms = performance.now() - t0;
  expect(bodies).toHaveLength(1);
  expect(sink.stats().queued).toBe(1);
  expect(ms).toBeLessThan(500); // the backoff is 60 s; anything near that means we waited
});

test("F061: idempotencyKey — same across retries of a record, different between records, not overwritable", async () => {
  const { bodies, fetchImpl } = scriptedFetch([503, 503, 200, 200]);
  const sink = sinkWith(fetchImpl);
  await sink.record(usage({ labels: { idempotencyKey: "a-label-trying-to-clobber-it" } }));
  await sink.flush(); // 2nd attempt: 503 again
  await sink.flush(); // 3rd attempt: 200
  await sink.record(usage());

  const keys = bodies.map((b) => JSON.parse(b).tags.idempotencyKey as string);
  expect(keys).toHaveLength(4);
  // The three attempts of the first record carry ONE key — that is what lets the
  // receiver collapse a retry of something it already stored into one row.
  expect(new Set(keys.slice(0, 3)).size).toBe(1);
  // The second record has its own.
  expect(keys[3]).not.toBe(keys[0]);
  // And a consumer label named the same cannot replace it.
  expect(keys[0]).not.toBe("a-label-trying-to-clobber-it");
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
});

test("F061: the queue is capped at 30 — overflow drops the OLDEST and counts it lost", async () => {
  const { fetchImpl } = scriptedFetch(["throw"]);
  const errors: unknown[] = [];
  const sink = sinkWith(fetchImpl, { onError: (e: unknown) => errors.push(e) });
  for (let i = 0; i < 35; i += 1) await sink.record(usage());
  expect(sink.stats()).toEqual({ sent: 0, retried: 0, dropped: 5, rejected: 0, queued: 30 });
  expect(errors).toHaveLength(5);
  expect(String(errors[0])).toContain("queue full");
});

test("F061: a record that keeps failing is given up after 5 attempts, and reported lost", async () => {
  const { bodies, fetchImpl } = scriptedFetch(["throw"]);
  const errors: unknown[] = [];
  const sink = sinkWith(fetchImpl, { onError: (e: unknown) => errors.push(e) });
  await sink.record(usage());
  for (let i = 0; i < 6; i += 1) await sink.flush(); // more flushes than attempts left
  expect(bodies).toHaveLength(5); // 1 first attempt + 4 retries
  expect(sink.stats()).toEqual({ sent: 0, retried: 4, dropped: 1, rejected: 0, queued: 0 });
  expect(errors).toHaveLength(1);
});

test("F061: retry:false is exactly the old behaviour — one attempt, nothing queued", async () => {
  const { bodies, fetchImpl } = scriptedFetch(["throw", 200]);
  const errors: unknown[] = [];
  const sink = sinkWith(fetchImpl, { retry: false, onError: (e: unknown) => errors.push(e) });
  await sink.record(usage());
  await sink.flush();
  expect(bodies).toHaveLength(1);
  expect(sink.stats()).toEqual({ sent: 0, retried: 0, dropped: 1, rejected: 0, queued: 0 });
  expect(errors).toHaveLength(1);
});

test("F061: the background timer delivers on its own, without flush()", async () => {
  const { bodies, fetchImpl } = scriptedFetch([503, 200]);
  const sink = sinkWith(fetchImpl, { retryBaseMs: 5 });
  await sink.record(usage());
  for (let i = 0; i < 40 && sink.stats().sent === 0; i += 1) await Bun.sleep(10);
  expect(sink.stats()).toEqual({ sent: 1, retried: 1, dropped: 0, rejected: 0, queued: 0 });
  expect(bodies).toHaveLength(2);
});

test("F061: the retry timer does NOT hold a process open (unref)", () => {
  // Measured in a real subprocess, because it is a claim about the process, not the
  // object. Without unref this script would sit out the 60 s backoff before exiting.
  const script = `
    import { upmetricsSink } from "./src/cost/sinks/upmetrics.ts";
    const sink = upmetricsSink({ baseUrl: "https://x.invalid", apiKey: "k", agentName: "t",
      retryBaseMs: 60000, fetch: async () => { throw new Error("down"); } });
    await sink.record({ provider:"p", model:"m", transport:"http", capability:"chat", region:"eu",
      inputTokens:1, outputTokens:1, cacheReadTokens:0, cacheCreationTokens:0, costUsd:0, latencyMs:1, ts:"" });
    console.log("queued=" + sink.stats().queued);
  `;
  const t0 = performance.now();
  const r = Bun.spawnSync({ cmd: ["bun", "-e", script], cwd: `${import.meta.dir}/../../..`, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
  const ms = performance.now() - t0;
  expect(r.stdout.toString().trim()).toBe("queued=1"); // it really was waiting on a retry
  expect(r.exitCode).toBe(0);
  expect(ms).toBeLessThan(10_000); // and exited anyway
});

test("F061: under overflow during a concurrent flush, it is the OLDEST that is dropped", async () => {
  // Found in review: flush() used to push still-pending records to the BACK, so records
  // arriving mid-flush got ahead of them and the cap dropped NEW ones — while the error
  // message said "dropped the oldest". Reproduced before the fix: of 5 drops, 2 were new.
  const seen: string[] = [];
  const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
    seen.push(JSON.parse(String(init?.body)).purpose);
    await Bun.sleep(1);
    throw new Error("down");
  }) as unknown as typeof fetch;
  const sink = sinkWith(fetchImpl);

  for (let i = 0; i < 30; i += 1) await sink.record(usage({ purpose: `OLD-${i}` }));
  const f = sink.flush(); // retrying the 30 old ones…
  for (let i = 0; i < 5; i += 1) await sink.record(usage({ purpose: `NEW-${i}` })); // …while 5 arrive
  await f;
  expect(sink.stats().queued).toBe(30);
  expect(sink.stats().dropped).toBe(5);

  seen.length = 0;
  await sink.flush(); // one attempt each — shows exactly who survived the cap
  const survivors = [...new Set(seen)];
  expect(survivors.filter((s) => s.startsWith("NEW"))).toHaveLength(5); // every new one kept
  expect(survivors.filter((s) => s.startsWith("OLD"))).toHaveLength(25); // the 5 oldest went
  expect(survivors).not.toContain("OLD-0");
});
