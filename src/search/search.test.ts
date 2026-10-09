// F078.1 — search() with Brave and Cloudflare adapters, offline via injected fetch.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { search, SearchKeyMissingError } from "../index.js";

type Call = { url: string; init?: RequestInit };
function spy(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const calls: Call[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }) as typeof fetch;
  return { calls, f };
}

const saved = { ...process.env };
beforeEach(() => { delete process.env.BRAVE_API_KEY; delete process.env.CLOUDFLARE_ACCOUNT_ID; delete process.env.CLOUDFLARE_API_TOKEN; });
afterEach(() => { process.env = { ...saved }; });

const BRAVE = {
  web: { results: [
    { title: "Fysio Aalborg", url: "https://fysio.dk/a", description: "Holdtræning i Aalborg", language: "da", page_age: "2026-09-30T08:00:00" },
    { title: "Uden dato", url: "https://x.dk/b", description: "d" },
  ] },
};

test("brave: request carries key, count, language and country; response maps to the shared shape", async () => {
  const { calls, f } = spy(BRAVE, 200, { "x-request-id": "br-1" });
  const r = await search({ query: "fysioterapi Aalborg", lang: "da", country: "DK", limit: 5, provider: "brave" }, { fetch: f, credentials: { braveApiKey: "bk" } });
  const u = new URL(calls[0]!.url);
  expect({ host: u.host, path: u.pathname, q: u.searchParams.get("q"), count: u.searchParams.get("count"), lang: u.searchParams.get("search_lang"), country: u.searchParams.get("country") })
    .toEqual({ host: "api.search.brave.com", path: "/res/v1/web/search", q: "fysioterapi Aalborg", count: "5", lang: "da", country: "DK" });
  expect((calls[0]!.init!.headers as Record<string, string>)["X-Subscription-Token"]).toBe("bk");
  expect(r.items).toEqual([
    { title: "Fysio Aalborg", url: "https://fysio.dk/a", description: "Holdtræning i Aalborg", provider: "brave", lang: "da", publishedAt: new Date("2026-09-30T08:00:00").toISOString() },
    { title: "Uden dato", url: "https://x.dk/b", description: "d", provider: "brave" },
  ]);
  expect(r.meta).toMatchObject({ provider: "brave", cached: false, costUsd: 0.005, requestId: "br-1" });
});

test("cloudflare: POST body {query, provider, limit} with Bearer; limit is capped at 10", async () => {
  const { calls, f } = spy({ items: [{ url: "https://e.com", title: "T", description: "D" }], metadata: { requestId: "cf-9", latencyMs: 600 } });
  const r = await search({ query: "best rag eval", limit: 25, provider: "cloudflare:ceramic" }, { fetch: f, credentials: { cloudflareAccountId: "acc", cloudflareApiToken: "tok" } });
  expect(calls[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/websearch/");
  expect(calls[0]!.init!.method).toBe("POST");
  expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
  expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ query: "best rag eval", provider: "ceramic", limit: 10 });
  expect(r.items).toEqual([{ title: "T", url: "https://e.com", description: "D", provider: "cloudflare:ceramic" }]);
  expect(r.meta).toMatchObject({ provider: "cloudflare:ceramic", costUsd: 0.00025, requestId: "cf-9" });
});

test("cloudflare: the v4 { result } wrapper is accepted too", async () => {
  const { f } = spy({ success: true, result: { items: [{ url: "u", title: "t", description: "d" }], metadata: { requestId: "w" } } });
  const r = await search({ query: "q", provider: "cloudflare:linkup" }, { fetch: f, credentials: { cloudflareAccountId: "a", cloudflareApiToken: "t" } });
  expect(r.items[0]!.provider).toBe("cloudflare:linkup");
  expect(r.meta.requestId).toBe("w");
});

test("a query over 1024 characters is refused BEFORE any request", async () => {
  const { calls, f } = spy({});
  await expect(search({ query: "x".repeat(1025), provider: "cloudflare:exa" }, { fetch: f, credentials: { cloudflareAccountId: "a", cloudflareApiToken: "t" } })).rejects.toThrow(/1–1024/);
  expect(calls).toHaveLength(0);
});

test("price per call is exact for every provider", async () => {
  const cf = { cloudflareAccountId: "a", cloudflareApiToken: "t" };
  const prices: Record<string, number> = {};
  for (const p of ["cloudflare:ceramic", "cloudflare:linkup", "cloudflare:exa"] as const) {
    prices[p] = (await search({ query: "q", provider: p }, { fetch: spy({ items: [] }).f, credentials: cf })).meta.costUsd;
  }
  prices.brave = (await search({ query: "q", provider: "brave" }, { fetch: spy({ web: { results: [] } }).f, credentials: { braveApiKey: "k" } })).meta.costUsd;
  expect(prices).toEqual({ "cloudflare:ceramic": 0.00025, "cloudflare:linkup": 0.005, "cloudflare:exa": 0.007, brave: 0.005 });
});

test("a missing key names the env var and sends nothing", async () => {
  const { calls, f } = spy({});
  await expect(search({ query: "q", provider: "brave" }, { fetch: f })).rejects.toThrow(/BRAVE_API_KEY/);
  await expect(search({ query: "q", provider: "cloudflare:linkup" }, { fetch: f })).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/);
  await expect(search({ query: "q", provider: "cloudflare:linkup" }, { fetch: f, credentials: { cloudflareAccountId: "a" } })).rejects.toBeInstanceOf(SearchKeyMissingError);
  expect(calls).toHaveLength(0);
});

test("env keys are used when no credentials are passed", async () => {
  process.env.BRAVE_API_KEY = "envkey";
  const { calls, f } = spy({ web: { results: [] } });
  await search({ query: "q", provider: "brave" }, { fetch: f });
  expect((calls[0]!.init!.headers as Record<string, string>)["X-Subscription-Token"]).toBe("envkey");
});

test("an HTTP error surfaces with its status", async () => {
  const { f } = spy({ error: "rate" }, 429);
  await expect(search({ query: "q", provider: "brave" }, { fetch: f, credentials: { braveApiKey: "k" } })).rejects.toMatchObject({ status: 429 });
});
