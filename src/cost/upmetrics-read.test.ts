import { expect, test } from "bun:test";
import { upmetricsCostClient, UpmetricsCostError, usdFromMicro } from "./upmetrics-read.js";

function jsonFetch(payload: unknown, opts?: { status?: number; capture?: (url: string, init?: RequestInit) => void }) {
  return (async (url: string, init?: RequestInit) => {
    opts?.capture?.(url, init);
    return new Response(JSON.stringify(payload), {
      status: opts?.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const SUMMARY = {
  generated_at: "2026-06-02T09:40:00.000Z",
  window: { from: "2026-05-26T09:40:00.000Z", to: "2026-06-02T09:40:00.000Z" },
  total_micro_usd: 7407,
  input_tokens: 1704,
  output_tokens: 153,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  run_count: 1,
  metered: { metered_micro_usd: 7407, free_run_count: 0 },
  by_provider: [{ key: "anthropic", micro_usd: 7407, input_tokens: 1704, output_tokens: 153, run_count: 1 }],
  by_model: [{ key: "claude-sonnet-4-6", micro_usd: 7407, input_tokens: 1704, output_tokens: 153, run_count: 1 }],
  by_tier: [{ key: "vision", micro_usd: 7407, input_tokens: 1704, output_tokens: 153, run_count: 1 }],
  by_capability: [{ key: "vision", micro_usd: 7407, input_tokens: 1704, output_tokens: 153, run_count: 1 }],
};

test("summary: parses the COST-API shape + sends the X-Upmetrics-Key header", async () => {
  let seenUrl = "";
  let seenKey = "";
  const client = upmetricsCostClient({
    baseUrl: "https://upmetrics.org",
    apiKey: "uk_test",
    fetch: jsonFetch(SUMMARY, {
      capture: (url, init) => {
        seenUrl = url;
        seenKey = new Headers(init?.headers).get("X-Upmetrics-Key") ?? "";
      },
    }),
  });
  const s = await client.summary({ window: "week" });
  expect(s.total_micro_usd).toBe(7407);
  expect(usdFromMicro(s.total_micro_usd)).toBeCloseTo(0.007407, 9);
  expect(s.by_provider[0]!.key).toBe("anthropic");
  expect(seenUrl).toBe("https://upmetrics.org/api/cost/summary?window=week");
  expect(seenKey).toBe("uk_test");
});

test("summary: groupBy + tag + agentName filters build the right query", async () => {
  let seenUrl = "";
  const client = upmetricsCostClient({
    baseUrl: "https://upmetrics.org/", // trailing slash trimmed
    apiKey: "uk_test",
    fetch: jsonFetch({ ...SUMMARY, group_by: "tenantId", by_group: [{ key: "sanne", micro_usd: 30000, input_tokens: 0, output_tokens: 0, run_count: 2 }] }, { capture: (u) => (seenUrl = u) }),
  });
  const s = await client.summary({ window: "month", groupBy: "tenantId", agentName: "trail", tags: { tenantId: "sanne" } });
  expect(s.by_group?.[0]!.key).toBe("sanne");
  expect(seenUrl).toContain("/api/cost/summary?");
  expect(seenUrl).toContain("window=month");
  expect(seenUrl).toContain("groupBy=tenantId");
  expect(seenUrl).toContain("agent_name=trail");
  expect(seenUrl).toContain("tag.tenantId=sanne");
});

test("explicit from/to overrides window (window not sent)", async () => {
  let seenUrl = "";
  const client = upmetricsCostClient({
    baseUrl: "https://upmetrics.org",
    apiKey: "uk_test",
    fetch: jsonFetch(SUMMARY, { capture: (u) => (seenUrl = u) }),
  });
  await client.summary({ window: "week", from: "2026-05-01T00:00:00Z", to: "2026-06-01T00:00:00Z" });
  expect(seenUrl).toContain("from=2026-05-01");
  expect(seenUrl).toContain("to=2026-06-01");
  expect(seenUrl).not.toContain("window=");
});

test("timeseries: parses points + bucket query", async () => {
  let seenUrl = "";
  const client = upmetricsCostClient({
    baseUrl: "https://upmetrics.org",
    apiKey: "uk_test",
    fetch: jsonFetch(
      {
        generated_at: "2026-06-02T09:40:00.000Z",
        bucket: "day",
        window: { from: "2026-05-03T09:40:00.000Z", to: "2026-06-02T09:40:00.000Z" },
        points: [{ ts: "2026-06-02T00:00:00Z", micro_usd: 7407, input_tokens: 1704, output_tokens: 153, run_count: 1 }],
      },
      { capture: (u) => (seenUrl = u) },
    ),
  });
  const ts = await client.timeseries({ bucket: "day", window: "month" });
  expect(ts.points).toHaveLength(1);
  expect(ts.points[0]!.micro_usd).toBe(7407);
  expect(seenUrl).toContain("/api/cost/timeseries?");
  expect(seenUrl).toContain("bucket=day");
});

test("401 invalid_api_key surfaces as a typed UpmetricsCostError (not a silent empty)", async () => {
  const client = upmetricsCostClient({
    baseUrl: "https://upmetrics.org",
    apiKey: "uk_bad",
    fetch: jsonFetch({ error: "invalid_api_key" }, { status: 401 }),
  });
  let caught: unknown;
  try {
    await client.summary();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(UpmetricsCostError);
  expect((caught as UpmetricsCostError).status).toBe(401);
  expect((caught as UpmetricsCostError).code).toBe("invalid_api_key");
});

test("network failure throws UpmetricsCostError (sink-read never silently resolves)", async () => {
  const client = upmetricsCostClient({
    baseUrl: "https://upmetrics.org",
    apiKey: "uk_test",
    fetch: (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch,
  });
  await expect(client.summary()).rejects.toBeInstanceOf(UpmetricsCostError);
});
