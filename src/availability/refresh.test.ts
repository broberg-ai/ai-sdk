import { expect, test, beforeEach } from "bun:test";
import { refreshAvailability, resetRefreshState } from "./refresh.js";
import { resetRegistry, getEntry } from "./registry.js";
import { listModels } from "./resolve.js";

beforeEach(() => {
  resetRegistry();
  resetRefreshState();
});

/** Fake Anthropic /v1/models returning the given ids, counting calls. */
function modelsFetch(ids: string[], counter: { n: number }): typeof fetch {
  return (async () => {
    counter.n++;
    return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
  }) as unknown as typeof fetch;
}

test("a model absent from the live list is marked unavailable; present stays available", async () => {
  const counter = { n: 0 };
  // Live list includes opus + sonnet + haiku but NOT fable.
  const res = await refreshAvailability({
    apiKey: "sk-test",
    fetch: modelsFetch(["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"], counter),
    now: 1000,
  });
  expect(res.refreshed).toBe(true);
  expect(res.markedUnavailable).toContain("claude-fable-5");
  expect(getEntry("claude-fable-5")!.available).toBe(false);
  expect(getEntry("claude-fable-5")!.source).toBe("refresh");
  expect(getEntry("claude-opus-4-8")!.available).toBe(true);
});

test("a model that comes BACK in the live list is re-marked available", async () => {
  const counter = { n: 0 };
  // Fable present again → should flip from the suspended default to available.
  await refreshAvailability({ apiKey: "sk-test", fetch: modelsFetch(["claude-fable-5", "claude-opus-4-8"], counter), now: 1000 });
  expect(getEntry("claude-fable-5")!.available).toBe(true);
  expect(getEntry("claude-fable-5")!.status).toBe("available");
});

test("TTL: a second call within the window does NOT re-fetch", async () => {
  const counter = { n: 0 };
  const f = modelsFetch(["claude-opus-4-8"], counter);
  await refreshAvailability({ apiKey: "sk-test", fetch: f, ttlMs: 10_000, now: 1000 });
  const second = await refreshAvailability({ apiKey: "sk-test", fetch: f, ttlMs: 10_000, now: 5000 });
  expect(counter.n).toBe(1); // not re-fetched
  expect(second.refreshed).toBe(false);
});

test("TTL: a call after the window DOES re-fetch", async () => {
  const counter = { n: 0 };
  const f = modelsFetch(["claude-opus-4-8"], counter);
  await refreshAvailability({ apiKey: "sk-test", fetch: f, ttlMs: 10_000, now: 1000 });
  await refreshAvailability({ apiKey: "sk-test", fetch: f, ttlMs: 10_000, now: 20_000 });
  expect(counter.n).toBe(2);
});

test("no API key → not refreshed, defaults intact (no throw)", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const res = await refreshAvailability({ now: 1000 });
    expect(res.refreshed).toBe(false);
    expect(getEntry("claude-opus-4-8")!.available).toBe(true); // untouched
  } finally {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  }
});

test("network error → not refreshed, defaults intact (never hard-fails)", async () => {
  const res = await refreshAvailability({
    apiKey: "sk-test",
    fetch: (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch,
    now: 1000,
  });
  expect(res.refreshed).toBe(false);
  expect(getEntry("claude-opus-4-8")!.available).toBe(true);
});

test("empty live list → not refreshed (treated as an API hiccup, not mass death)", async () => {
  const counter = { n: 0 };
  const res = await refreshAvailability({ apiKey: "sk-test", fetch: modelsFetch([], counter), now: 1000 });
  expect(res.refreshed).toBe(false);
  expect(getEntry("claude-opus-4-8")!.available).toBe(true);
  // opus must NOT have been suspended by an empty list
  expect(listModels().find((m) => m.id === "claude-opus-4-8")!.available).toBe(true);
});

test("non-anthropic provider → no-op in v1", async () => {
  const res = await refreshAvailability({ provider: "openai" as "anthropic", apiKey: "x", now: 1000 });
  expect(res.refreshed).toBe(false);
});
