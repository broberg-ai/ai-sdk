// F078 — `search()`: the one entry point.
// F078.1: adapters + shared shape. F078.2: router (when no provider is given), fallback
// chain, cache, and a cost-sink row for every call and every failed attempt.
// Tenant BYOK + daily caps arrive in F078.3.
import { braveSearch } from "./brave.js";
import { cloudflareSearch } from "./cloudflare.js";
import { SEARCH_PRICE_USD } from "./prices.js";
import { routeSearch } from "./router.js";
import { memorySearchCache, SEARCH_CACHE_TTL_MS, searchCacheKey } from "./cache.js";
import { classifyFailure } from "../cost/failure.js";
import type { Usage } from "../types.js";
import {
  SearchBudgetExceededError,
  SearchKeyMissingError,
  type SearchCapStore,
  type SearchItem,
  type SearchOptions,
  type SearchProviderId,
  type SearchRequest,
  type SearchResult,
} from "./types.js";

const sharedCache = memorySearchCache();

const sharedCapStore: SearchCapStore = (() => {
  const m = new Map<string, number>();
  return { getSpent: (k) => m.get(k) ?? 0, addSpent: (k, usd) => { m.set(k, (m.get(k) ?? 0) + usd); } };
})();

/** Calendar day in Danish time — a "day" for the cap is the owner's day, not UTC's. */
const copenhagenDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(d);

async function callProvider(provider: SearchProviderId, req: SearchRequest, opts: SearchOptions) {
  const f = opts.fetch ?? fetch;
  const c = opts.credentials ?? {};
  // byok: never the fleet's env keys — a missing customer key is a missing key.
  const env = opts.byok ? {} : process.env;
  if (provider === "brave") {
    const key = c.braveApiKey ?? env.BRAVE_API_KEY;
    if (!key) throw new SearchKeyMissingError(provider, "BRAVE_API_KEY");
    return braveSearch({ ...req, provider }, key, f);
  }
  if (provider.startsWith("cloudflare:")) {
    const accountId = c.cloudflareAccountId ?? env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = c.cloudflareApiToken ?? env.CLOUDFLARE_API_TOKEN;
    if (!accountId) throw new SearchKeyMissingError(provider, "CLOUDFLARE_ACCOUNT_ID");
    if (!apiToken) throw new SearchKeyMissingError(provider, "CLOUDFLARE_API_TOKEN");
    return cloudflareSearch({ ...req, provider }, { accountId, apiToken }, f);
  }
  throw new Error(`search: unknown provider "${String(provider)}"`);
}

function usageRow(provider: SearchProviderId, req: SearchRequest, costUsd: number, latencyMs: number): Usage {
  return {
    provider,
    model: "web-search",
    region: "unknown", // Brave and Cloudflare's gateway do not let us say where a query is served
    transport: "http",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd,
    costBasis: "computed",
    latencyMs,
    capability: "search",
    ...(req.purpose ? { purpose: req.purpose } : {}),
    ...(req.labels ? { labels: req.labels } : {}),
    ts: new Date().toISOString(),
  } as Usage;
}

export async function search(req: SearchRequest, opts: SearchOptions = {}): Promise<SearchResult> {
  const chain = routeSearch(req);
  if (chain.length === 0) throw new Error("search: no provider fits this request (zdr excludes every candidate)");
  const cache = opts.cache === false ? undefined : (opts.cache ?? sharedCache);
  const ttl = SEARCH_CACHE_TTL_MS[req.purpose ?? "agent"];
  const sink = opts.costSink;
  const capStore = opts.capStore ?? sharedCapStore;
  const tenant = req.labels?.tenantId ?? "_";
  const day = copenhagenDay((opts.now ?? (() => new Date()))());
  const capKey = JSON.stringify([tenant, day]);

  let lastErr: unknown;
  for (const provider of chain) {
    const key = searchCacheKey(provider, req);
    const hit = cache?.get(key);
    if (hit) return { items: hit.items, meta: { ...hit.meta, cached: true, costUsd: 0, latencyMs: 0 } };

    if (opts.dailyCapUsd !== undefined) {
      const spent = await capStore.getSpent(capKey);
      const price = SEARCH_PRICE_USD[provider];
      // Not a provider failure, so it does not fall through: the cap stops the call.
      if (spent + price > opts.dailyCapUsd) throw new SearchBudgetExceededError(tenant, day, opts.dailyCapUsd, spent, price);
    }

    const t0 = performance.now();
    try {
      const out = await callProvider(provider, req, opts);
      const latencyMs = Math.round(performance.now() - t0);
      const result: SearchResult = {
        items: dedupe(out.items),
        meta: { provider, latencyMs, cached: false, costUsd: SEARCH_PRICE_USD[provider], ...(out.requestId ? { requestId: out.requestId } : {}) },
      };
      cache?.set(key, result, ttl);
      await capStore.addSpent(capKey, result.meta.costUsd); // always, so a cap set later in the day sees the earlier spend
      try { await sink?.record(usageRow(provider, req, result.meta.costUsd, latencyMs)); } catch { /* a sink never breaks a call */ }
      return result;
    } catch (e) {
      lastErr = e;
      if (sink?.recordFailure) {
        try {
          await sink.recordFailure({
            provider, model: "web-search", transport: "http", capability: "search",
            ...(req.purpose ? { purpose: req.purpose } : {}),
            ...(req.labels ? { labels: req.labels } : {}),
            latencyMs: Math.round(performance.now() - t0),
            ts: new Date().toISOString(),
            ...classifyFailure(e),
          });
        } catch { /* never breaks the call */ }
      }
    }
  }
  throw lastErr;
}

/** Same URL twice (a provider repeating itself) collapses to the first. */
function dedupe(items: SearchItem[]): SearchItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));
}

export { SEARCH_PRICE_USD } from "./prices.js";
export { DEFAULT_SEARCH_ROUTES, ZDR_PROVIDERS, routeSearch, type SearchRoute } from "./router.js";
export { memorySearchCache, SEARCH_CACHE_TTL_MS } from "./cache.js";
export { SearchBudgetExceededError, SearchKeyMissingError } from "./types.js";
export type { SearchCapStore, SearchItem, SearchOptions, SearchProviderId, SearchRequest, SearchResult, SearchCredentials, SearchCache, SearchPurpose } from "./types.js";
