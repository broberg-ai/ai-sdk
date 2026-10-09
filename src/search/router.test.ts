// F078.2 — router, fallback, cache, cost-sink rows.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createAI, memorySearchCache, routeSearch, search } from "../index.js";
import type { CallFailure } from "../cost/failure.js";
import type { CostSink, Usage } from "../types.js";

test("routing rules (SEARCH-PLAN §5)", () => {
  expect(routeSearch({ query: "q", lang: "en", purpose: "agent" })).toEqual(["cloudflare:ceramic", "cloudflare:linkup", "brave"]);
  expect(routeSearch({ query: "q", lang: "en", purpose: "grounding" })[0]).toBe("cloudflare:ceramic");
  expect(routeSearch({ query: "q", lang: "da" })).toEqual(["cloudflare:linkup", "brave"]);
  expect(routeSearch({ query: "q", lang: "da", fresh: true })).toEqual(["brave", "cloudflare:linkup"]);
  expect(routeSearch({ query: "q", lang: "en", country: "DK" })[0]).toBe("brave");
});

test("Ceramic (English-only) is never routed a non-English query; Exa only when asked for", () => {
  for (const lang of ["da", "de", "sv"]) expect(routeSearch({ query: "q", lang })).not.toContain("cloudflare:ceramic");
  for (const r of [{ lang: "en" }, { lang: "da" }, { lang: "en", fresh: true }]) expect(routeSearch({ query: "q", ...r })).not.toContain("cloudflare:exa");
  expect(routeSearch({ query: "q", provider: "cloudflare:exa" })).toEqual(["cloudflare:exa"]);
});

test("zdr:true keeps only Zero-Data-Retention providers (no Brave, no Exa)", () => {
  expect(routeSearch({ query: "q", lang: "da", zdr: true })).toEqual(["cloudflare:linkup"]);
  expect(routeSearch({ query: "q", lang: "en", purpose: "agent", zdr: true })).toEqual(["cloudflare:ceramic", "cloudflare:linkup"]);
  expect(routeSearch({ query: "q", lang: "da", fresh: true, zdr: true })).toEqual(["cloudflare:linkup"]);
});

// ── fallback + cost rows ────────────────────────────────────────────────────
const CF = { cloudflareAccountId: "a", cloudflareApiToken: "t", braveApiKey: "b" };
function sinkSpy() {
  const rows: Usage[] = []; const fails: CallFailure[] = [];
  const sink: CostSink = { async record(u) { rows.push(u); }, async recordFailure(f) { fails.push(f); } };
  return { rows, fails, sink };
}
/** Linkup answers 429, Brave answers 200. */
const flaky = (async (url: string | URL) => String(url).includes("cloudflare")
  ? new Response("rate", { status: 429 })
  : new Response(JSON.stringify({ web: { results: [{ title: "t", url: "https://b.dk", description: "d" }] } }), { status: 200 })) as unknown as typeof fetch;

test("a 429 from the first provider falls through to the next; meta says who answered; both attempts are recorded", async () => {
  const { rows, fails, sink } = sinkSpy();
  const r = await search({ query: "fysio", lang: "da", labels: { tenantId: "fd" } }, { fetch: flaky, credentials: CF, cache: false, costSink: sink });
  expect(r.meta.provider).toBe("brave");
  expect(fails.map((f) => ({ p: f.provider, code: f.errorCode, cap: f.capability }))).toEqual([{ p: "cloudflare:linkup", code: "429", cap: "search" }]);
  expect(rows.map((u) => ({ p: u.provider, cap: u.capability, cost: u.costUsd, tenant: u.labels?.tenantId }))).toEqual([{ p: "brave", cap: "search", cost: 0.005, tenant: "fd" }]);
});

test("a missing key for the first provider falls through instead of failing the call", async () => {
  delete process.env.CLOUDFLARE_ACCOUNT_ID; delete process.env.CLOUDFLARE_API_TOKEN;
  const f = (async () => new Response(JSON.stringify({ web: { results: [] } }), { status: 200 })) as unknown as typeof fetch;
  const r = await search({ query: "q", lang: "da" }, { fetch: f, credentials: { braveApiKey: "b" }, cache: false });
  expect(r.meta.provider).toBe("brave");
});

test("when every provider fails, the last error is thrown", async () => {
  const f = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
  await expect(search({ query: "q", lang: "da" }, { fetch: f, credentials: CF, cache: false })).rejects.toMatchObject({ status: 503 });
});

test("cache: the same normalized query is served from cache at $0 and the provider is not called again", async () => {
  let calls = 0;
  const f = (async () => { calls++; return new Response(JSON.stringify({ items: [{ url: "u", title: "t", description: "d" }] }), { status: 200 }); }) as unknown as typeof fetch;
  const cache = memorySearchCache();
  const { rows, sink } = sinkSpy();
  const a = await search({ query: "Best  RAG eval", lang: "en", purpose: "agent" }, { fetch: f, credentials: CF, cache, costSink: sink });
  const b = await search({ query: "best rag eval ", lang: "en", purpose: "agent" }, { fetch: f, credentials: CF, cache, costSink: sink });
  expect(calls).toBe(1);
  expect({ cached: a.meta.cached, cost: a.meta.costUsd }).toEqual({ cached: false, cost: 0.00025 });
  expect({ cached: b.meta.cached, cost: b.meta.costUsd }).toEqual({ cached: true, cost: 0 });
  expect(rows).toHaveLength(1); // a cache hit costs nothing and books nothing
});

test("duplicate URLs from one provider collapse to the first", async () => {
  const f = (async () => new Response(JSON.stringify({ items: [{ url: "u", title: "1", description: "" }, { url: "u", title: "2", description: "" }] }), { status: 200 })) as unknown as typeof fetch;
  const r = await search({ query: "q", provider: "cloudflare:linkup" }, { fetch: f, credentials: CF, cache: false });
  expect(r.items.map((i) => i.title)).toEqual(["1"]);
});

// ── ai.search: the client's sink and labels ─────────────────────────────────
const saved = { ...process.env };
beforeEach(() => { process.env.CLOUDFLARE_ACCOUNT_ID = "a"; process.env.CLOUDFLARE_API_TOKEN = "t"; });
afterEach(() => { process.env = { ...saved }; });

test("ai.search books the call on the client's cost sink with the client's labels", async () => {
  const { rows, sink } = sinkSpy();
  const f = (async () => new Response(JSON.stringify({ items: [] }), { status: 200 })) as unknown as typeof fetch;
  const ai = createAI({ costSink: sink, labels: { app: "scout" } });
  await ai.search({ query: "q", lang: "da", labels: { tenantId: "t1" } }, { fetch: f, cache: false });
  expect(rows.map((u) => ({ cap: u.capability, labels: u.labels }))).toEqual([{ cap: "search", labels: { app: "scout", tenantId: "t1" } }]);
});
