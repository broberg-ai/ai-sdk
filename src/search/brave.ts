// F078.1 — Brave Search API, direct. GET with X-Subscription-Token.
// Brave is the only provider here with language, country and freshness filters.
import type { SearchItem, SearchRequest } from "./types.js";

interface BraveResponse {
  web?: { results?: { title?: string; url?: string; description?: string; language?: string; page_age?: string }[] };
}

export async function braveSearch(req: SearchRequest, apiKey: string, f: typeof fetch): Promise<{ items: SearchItem[]; requestId?: string }> {
  const params = new URLSearchParams({ q: req.query, count: String(Math.min(req.limit ?? 10, 20)) });
  if (req.lang) params.set("search_lang", req.lang);
  if (req.country) params.set("country", req.country);
  const res = await f(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { accept: "application/json", "X-Subscription-Token": apiKey },
  });
  if (!res.ok) throw Object.assign(new Error(`brave search: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`), { status: res.status });
  const body = (await res.json()) as BraveResponse;
  const items = (body.web?.results ?? []).map((r): SearchItem => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.description ?? "",
    provider: "brave",
    ...(r.language ? { lang: r.language } : {}),
    ...(r.page_age ? { publishedAt: new Date(r.page_age).toISOString() } : {}),
  }));
  return { items, requestId: res.headers.get("x-request-id") ?? undefined };
}
