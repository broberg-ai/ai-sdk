// F078.5 — Tavily, direct. Kept only for the CMS sites already configured with it
// (SEARCH-PLAN §8); never chosen by the router. Read 2026-10-09 from
// docs.tavily.com: POST /search, Bearer auth, a basic search costs 1 credit.
import type { SearchItem, SearchRequest } from "./types.js";

interface TavilyResponse {
  results?: { title?: string; url?: string; content?: string; published_date?: string }[];
  request_id?: string;
}

export async function tavilySearch(req: SearchRequest, apiKey: string, f: typeof fetch): Promise<{ items: SearchItem[]; requestId?: string }> {
  const res = await f("https://api.tavily.com/search", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ query: req.query, max_results: Math.min(req.limit ?? 10, 20), search_depth: "basic" }),
  });
  if (!res.ok) throw Object.assign(new Error(`tavily search: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`), { status: res.status });
  const body = (await res.json()) as TavilyResponse;
  const items = (body.results ?? []).map((r): SearchItem => {
    const published = r.published_date ? new Date(r.published_date) : undefined;
    return {
      title: r.title ?? "",
      url: r.url ?? "",
      description: r.content ?? "",
      provider: "tavily",
      ...(published && !Number.isNaN(published.getTime()) ? { publishedAt: published.toISOString() } : {}),
    };
  });
  return { items, ...(body.request_id ? { requestId: body.request_id } : {}) };
}
