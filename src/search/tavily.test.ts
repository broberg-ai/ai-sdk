// F078.5 — Tavily for CMS-legacy sites: explicit provider only, never routed, never ZDR.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { routeSearch, search, SearchKeyMissingError } from "./index.js";

const saved = process.env.TAVILY_API_KEY;
beforeEach(() => { process.env.TAVILY_API_KEY = "FLEET"; });
afterEach(() => { if (saved === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = saved; });

function spy(body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status: 200 }); }) as unknown as typeof fetch;
  return { calls, f };
}

test("tavily: POST /search with Bearer, basic depth; response mapped to the shared shape", async () => {
  const { calls, f } = spy({
    request_id: "req-1",
    results: [
      { title: "T", url: "https://t.dk", content: "snippet", published_date: "2026-10-01" },
      { title: "U", url: "https://u.dk", content: "s2", published_date: "not a date" },
    ],
  });
  const r = await search({ query: "fysio", provider: "tavily", limit: 5 }, { fetch: f, credentials: { tavilyApiKey: "tvly-SITE" }, cache: false });
  expect(calls[0]!.url).toBe("https://api.tavily.com/search");
  expect(calls[0]!.init!.method).toBe("POST");
  expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer tvly-SITE");
  expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ query: "fysio", max_results: 5, search_depth: "basic" });
  expect(r.items).toEqual([
    { title: "T", url: "https://t.dk", description: "snippet", provider: "tavily", publishedAt: "2026-10-01T00:00:00.000Z" },
    { title: "U", url: "https://u.dk", description: "s2", provider: "tavily" },
  ]);
  expect(r.meta).toMatchObject({ provider: "tavily", costUsd: 0.0075, requestId: "req-1" });
});

test("tavily is never chosen by the router, even from a custom table", () => {
  for (const r of [{ lang: "en", purpose: "agent" as const }, { lang: "da" }, { fresh: true }]) expect(routeSearch({ query: "q", ...r })).not.toContain("tavily");
  const custom = [{ name: "all-tavily", when: {}, chain: ["tavily" as const, "brave" as const] }];
  expect(routeSearch({ query: "q" }, custom)).toEqual(["brave"]);
});

test("tavily is not ZDR: zdr:true with provider tavily throws before any request", async () => {
  const { calls, f } = spy({ results: [] });
  await expect(search({ query: "q", provider: "tavily", zdr: true }, { fetch: f, credentials: { tavilyApiKey: "k" }, cache: false })).rejects.toThrow(/zdr/);
  expect(calls).toEqual([]);
});

test("tavily key: env TAVILY_API_KEY normally; byok never reads env", async () => {
  const a = spy({ results: [] });
  await search({ query: "q", provider: "tavily" }, { fetch: a.f, cache: false });
  expect((a.calls[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer FLEET");
  const b = spy({ results: [] });
  await expect(search({ query: "q", provider: "tavily" }, { fetch: b.f, byok: true, cache: false })).rejects.toBeInstanceOf(SearchKeyMissingError);
  expect(b.calls).toEqual([]);
});
