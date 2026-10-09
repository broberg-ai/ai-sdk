// F078 — `search()`: the one entry point. F078.1 needs an explicit provider; routing,
// fallback, cache and cost-sink reporting arrive in F078.2, tenant BYOK + caps in F078.3.
import { braveSearch } from "./brave.js";
import { cloudflareSearch } from "./cloudflare.js";
import { SEARCH_PRICE_USD } from "./prices.js";
import { SearchKeyMissingError, type SearchOptions, type SearchRequest, type SearchResult } from "./types.js";

export async function search(req: SearchRequest, opts: SearchOptions = {}): Promise<SearchResult> {
  const f = opts.fetch ?? fetch;
  const c = opts.credentials ?? {};
  const t0 = performance.now();
  let out: { items: SearchResult["items"]; requestId?: string };
  if (req.provider === "brave") {
    const key = c.braveApiKey ?? process.env.BRAVE_API_KEY;
    if (!key) throw new SearchKeyMissingError(req.provider, "BRAVE_API_KEY");
    out = await braveSearch(req, key, f);
  } else if (req.provider.startsWith("cloudflare:")) {
    const accountId = c.cloudflareAccountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = c.cloudflareApiToken ?? process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId) throw new SearchKeyMissingError(req.provider, "CLOUDFLARE_ACCOUNT_ID");
    if (!apiToken) throw new SearchKeyMissingError(req.provider, "CLOUDFLARE_API_TOKEN");
    out = await cloudflareSearch(req, { accountId, apiToken }, f);
  } else {
    throw new Error(`search: unknown provider "${String(req.provider)}"`);
  }
  return {
    items: out.items,
    meta: {
      provider: req.provider,
      latencyMs: Math.round(performance.now() - t0),
      cached: false,
      costUsd: SEARCH_PRICE_USD[req.provider],
      ...(out.requestId ? { requestId: out.requestId } : {}),
    },
  };
}

export { SEARCH_PRICE_USD } from "./prices.js";
export { SearchKeyMissingError } from "./types.js";
export type { SearchItem, SearchOptions, SearchProviderId, SearchRequest, SearchResult, SearchCredentials } from "./types.js";
