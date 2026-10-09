// F078.4 — the model chooses what to search for; the app chooses everything else.
import { expect, test } from "bun:test";
import { runWebSearch, webSearchTool } from "./index.js";
import * as root from "../index.js";

function spy() {
  const reqs: { url: string; body?: string; token?: string }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    reqs.push({ url: String(url), body: init?.body as string | undefined, token: (init?.headers as Record<string, string>)?.["X-Subscription-Token"] });
    return String(url).includes("cloudflare")
      ? new Response(JSON.stringify({ result: { items: [{ title: "L", url: "https://l.dk", description: "ls" }] }, success: true }), { status: 200 })
      : new Response(JSON.stringify({ web: { results: [{ title: "B", url: "https://b.dk", description: "bs" }] } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, reqs };
}
const CREDS = { braveApiKey: "b", cloudflareAccountId: "a", cloudflareApiToken: "t" };

test("webSearchTool is exported from the package root with a JSON-schema the model fills", () => {
  expect(root.webSearchTool).toBe(webSearchTool);
  expect(webSearchTool.name).toBe("web_search");
  const p = webSearchTool.parameters as { required: string[]; properties: Record<string, Record<string, unknown>>; additionalProperties: boolean };
  expect(p.required).toEqual(["query"]);
  expect(Object.keys(p.properties).sort()).toEqual(["fresh", "lang", "limit", "purpose", "query"]);
  expect(p.properties.limit).toMatchObject({ minimum: 1, maximum: 10 });
  expect(p.properties.purpose?.enum).toEqual(["agent", "grounding", "discovery", "monitor"]);
  expect(p.additionalProperties).toBe(false);
});

test("bad arguments from the model are refused before any request", async () => {
  const { f, reqs } = spy();
  for (const args of [{}, { query: "  " }, { query: "q", limit: 11 }, { query: "q", limit: 2.5 }, { query: "q", purpose: "hack" }, { query: "q", fresh: "yes" }]) {
    await expect(runWebSearch(args, { fetch: f, credentials: CREDS, cache: false })).rejects.toThrow(/web_search/);
  }
  expect(reqs).toEqual([]);
});

test("a valid call returns a compact { provider, results[title,url,snippet] } and uses the app's options", async () => {
  const { f, reqs } = spy();
  const rows: unknown[] = [];
  const r = await runWebSearch({ query: "q", provider: "brave" /* ignored */ }, {
    fetch: f, credentials: CREDS, byok: true, cache: false,
    costSink: { async record(u) { rows.push(u); } }, labels: { tenantId: "fd" },
  });
  // lang 'da' not given → English → ceramic first; the model's "brave" was dropped.
  expect(r).toEqual({ provider: "cloudflare:ceramic", results: [{ title: "L", url: "https://l.dk", snippet: "ls" }] });
  expect(rows.length).toBe(1);
  expect(reqs.length).toBe(1);
});

test("the model cannot pick a provider, turn zdr off, or switch tenant", async () => {
  const { f, reqs } = spy();
  const r = await runWebSearch(
    { query: "kunde Hansen", lang: "da", fresh: true, provider: "brave", zdr: false, labels: { tenantId: "other" } },
    { fetch: f, credentials: CREDS, cache: false, zdr: true, labels: { tenantId: "fd" }, costSink: { async record(u) { expect(u.labels).toEqual({ tenantId: "fd" }); } } },
  );
  // fresh would route to Brave, but the app's zdr keeps Linkup only; the model's provider/zdr/labels are dropped.
  expect(r.provider).toBe("cloudflare:linkup");
  expect(reqs.every((q) => q.url.includes("cloudflare"))).toBe(true);
  expect(JSON.parse(reqs[0]!.body!).provider).toBe("linkup");
});
