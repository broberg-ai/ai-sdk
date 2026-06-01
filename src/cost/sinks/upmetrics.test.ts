import { expect, test } from "bun:test";
import { upmetricsSink } from "./upmetrics.js";
import { SDK_TAG } from "../../version.js";
import type { Usage } from "../../types.js";

const usage = (over: Partial<Usage> = {}): Usage => ({
  provider: "anthropic",
  model: "claude-haiku-4-5",
  tier: "fast",
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

test("network failure is swallowed (never throws) and surfaces via onError", async () => {
  const errors: unknown[] = [];
  const failing = (async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;
  const sink = upmetricsSink({
    baseUrl: "https://upmetrics.org",
    apiKey: "k",
    agentName: "xrt81",
    fetch: failing,
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
