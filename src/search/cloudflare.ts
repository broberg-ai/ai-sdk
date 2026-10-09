// F078.1 — Cloudflare Web Search (AI Gateway) → Ceramic / Linkup / Exa.
// Measured from the docs 2026-10-09: POST .../ai/websearch/, query 1–1024 chars,
// limit 1–10, response { items:[{url,title,description}], metadata:{requestId,latencyMs} }.
// No date, no language, no filters — open beta.
import type { SearchItem, SearchProviderId, SearchRequest } from "./types.js";

export const CLOUDFLARE_MAX_QUERY = 1024;
export const CLOUDFLARE_MAX_LIMIT = 10;

interface CfResponse {
  items?: { url?: string; title?: string; description?: string }[];
  metadata?: { requestId?: string };
  result?: { items?: { url?: string; title?: string; description?: string }[]; metadata?: { requestId?: string } };
  success?: boolean;
  errors?: { message?: string }[];
}

export async function cloudflareSearch(
  req: SearchRequest,
  creds: { accountId: string; apiToken: string },
  f: typeof fetch,
): Promise<{ items: SearchItem[]; requestId?: string }> {
  if (req.query.length < 1 || req.query.length > CLOUDFLARE_MAX_QUERY) {
    throw new Error(`search: Cloudflare takes a query of 1–${CLOUDFLARE_MAX_QUERY} characters, got ${req.query.length}`);
  }
  const provider = req.provider!.split(":")[1] as "ceramic" | "linkup" | "exa";
  const res = await f(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(creds.accountId)}/ai/websearch/`, {
    method: "POST",
    headers: { authorization: `Bearer ${creds.apiToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query: req.query, provider, limit: Math.min(req.limit ?? CLOUDFLARE_MAX_LIMIT, CLOUDFLARE_MAX_LIMIT) }),
  });
  if (!res.ok) throw Object.assign(new Error(`cloudflare search (${provider}): HTTP ${res.status} ${(await res.text()).slice(0, 200)}`), { status: res.status });
  // The docs show the bare shape; Cloudflare's v4 API usually wraps in { result }. Accept both.
  const body = (await res.json()) as CfResponse;
  const inner = body.result ?? body;
  const items = (inner.items ?? []).map((r): SearchItem => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.description ?? "",
    provider: req.provider as SearchProviderId,
  }));
  return { items, requestId: inner.metadata?.requestId };
}
