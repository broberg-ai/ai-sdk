// F078.3 — a customer-key search never runs on the fleet's keys; a tenant's daily cap stops calls before they leave.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { search, SearchBudgetExceededError, SearchKeyMissingError, type SearchCapStore } from "./index.js";
import { createAI } from "../client.js";
import { byokAdapter } from "../byok.js";
import { openaiAdapter } from "../providers/openai.js";

const saved = process.env.BRAVE_API_KEY;
beforeEach(() => { process.env.BRAVE_API_KEY = "FLEET-KEY"; });
afterEach(() => { if (saved === undefined) delete process.env.BRAVE_API_KEY; else process.env.BRAVE_API_KEY = saved; });

function braveSpy() {
  const tokens: (string | undefined)[] = [];
  const f = (async (_url: string | URL, init?: RequestInit) => {
    tokens.push((init?.headers as Record<string, string>)?.["X-Subscription-Token"]);
    return new Response(JSON.stringify({ web: { results: [{ title: "t", url: "https://x.dk", description: "d" }] } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, tokens };
}

test("byok: the env key is never read — no credentials means a missing key and zero requests", async () => {
  const { f, tokens } = braveSpy();
  await expect(search({ query: "q", provider: "brave" }, { fetch: f, byok: true, cache: false })).rejects.toBeInstanceOf(SearchKeyMissingError);
  expect(tokens).toEqual([]);
});

test("byok: the customer's own key is the one sent", async () => {
  const { f, tokens } = braveSpy();
  await search({ query: "q", provider: "brave" }, { fetch: f, byok: true, credentials: { braveApiKey: "CUSTOMER" }, cache: false });
  expect(tokens).toEqual(["CUSTOMER"]);
});

test("without byok the env key is still the fallback (fleet tools)", async () => {
  const { f, tokens } = braveSpy();
  await search({ query: "q", provider: "brave" }, { fetch: f, cache: false });
  expect(tokens).toEqual(["FLEET-KEY"]);
});

test("createAI({ byok: true }).search runs in byok mode — the fleet key is not used", async () => {
  const { f, tokens } = braveSpy();
  const ai = createAI({ byok: true, costSink: null, providers: { openai: byokAdapter(openaiAdapter, { apiKey: "sk-CUSTOMER" }) } });
  await expect(ai.search({ query: "q", provider: "brave" }, { fetch: f, cache: false })).rejects.toBeInstanceOf(SearchKeyMissingError);
  expect(tokens).toEqual([]);
});

function memStore(): SearchCapStore & { m: Map<string, number> } {
  const m = new Map<string, number>();
  return { m, async getSpent(k) { return m.get(k) ?? 0; }, async addSpent(k, usd) { m.set(k, (m.get(k) ?? 0) + usd); } };
}
const NOON = () => new Date("2026-10-09T10:00:00Z");

test("daily cap: the call that would cross it throws before any request; only successful calls count; other tenants unaffected", async () => {
  const { f, tokens } = braveSpy();
  const capStore = memStore();
  const opts = { fetch: f, credentials: { braveApiKey: "k" }, cache: false as const, dailyCapUsd: 0.01, capStore, now: NOON };
  // Brave is $0.005 a call: two fit under $0.01, the third does not.
  await search({ query: "a", provider: "brave", labels: { tenantId: "fd" } }, opts);
  await search({ query: "b", provider: "brave", labels: { tenantId: "fd" } }, opts);
  const err = await search({ query: "c", provider: "brave", labels: { tenantId: "fd" } }, opts).catch((e) => e);
  expect(err).toBeInstanceOf(SearchBudgetExceededError);
  expect(tokens.length).toBe(2);
  // A failing call costs nothing.
  const down = (async () => new Response("x", { status: 503 })) as unknown as typeof fetch;
  await search({ query: "d", provider: "brave", labels: { tenantId: "lhd" } }, { ...opts, fetch: down }).catch(() => {});
  expect(capStore.m.get(JSON.stringify(["lhd", "2026-10-09"])) ?? 0).toBe(0);
  // Another tenant still searches.
  await search({ query: "e", provider: "brave", labels: { tenantId: "lhd" } }, opts);
  expect(tokens.length).toBe(3);
  expect(capStore.m.get(JSON.stringify(["fd", "2026-10-09"]))).toBe(0.01);
});

test("daily cap: a cache hit is free and allowed even at the cap", async () => {
  const { f, tokens } = braveSpy();
  const opts = { fetch: f, credentials: { braveApiKey: "k" }, dailyCapUsd: 0.005, capStore: memStore(), now: NOON, cache: undefined };
  const { memorySearchCache } = await import("./index.js");
  const cache = memorySearchCache();
  await search({ query: "same", provider: "brave", labels: { tenantId: "fd" } }, { ...opts, cache });
  const r = await search({ query: "same", provider: "brave", labels: { tenantId: "fd" } }, { ...opts, cache });
  expect(r.meta.cached).toBe(true);
  expect(tokens.length).toBe(1);
});

test("daily cap resets on a new calendar day in Europe/Copenhagen, not UTC", async () => {
  const { f } = braveSpy();
  const capStore = memStore();
  const base = { fetch: f, credentials: { braveApiKey: "k" }, cache: false as const, dailyCapUsd: 0.005, capStore };
  const req = { query: "q", provider: "brave" as const, labels: { tenantId: "fd" } };
  // 23:30 UTC on 9/10 is 01:30 on 10/10 in Copenhagen (CEST) — already the next day there.
  await search(req, { ...base, now: () => new Date("2026-10-09T21:00:00Z") }); // 23:00 Copenhagen, 9/10
  await expect(search(req, { ...base, now: () => new Date("2026-10-09T21:30:00Z") })).rejects.toBeInstanceOf(SearchBudgetExceededError);
  await search(req, { ...base, now: () => new Date("2026-10-09T23:30:00Z") });
  expect([...capStore.m.keys()]).toEqual([JSON.stringify(["fd", "2026-10-09"]), JSON.stringify(["fd", "2026-10-10"])]);
});
