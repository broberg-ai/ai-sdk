// F078 — web search as a shared capability (SEARCH-PLAN, Christian 2026-10-09).
// One request shape, one result shape, whichever provider answers. Apps import
// `search` from @broberg/ai-sdk and never talk to a search provider directly.

export type SearchProviderId = "brave" | "cloudflare:ceramic" | "cloudflare:linkup" | "cloudflare:exa";

/** Why the search runs — picks the route and the cache lifetime (F078.2). */
export type SearchPurpose = "agent" | "grounding" | "discovery" | "monitor";

export interface SearchRequest {
  query: string;
  /** BCP-47-ish language of the query ("da", "en"). Routing input (F078.2); Brave also filters on it. */
  lang?: string;
  /** Country hint for providers that filter on it (Brave: "DK"). */
  country?: string;
  /** Max results. Cloudflare caps at 10. */
  limit?: number;
  /** Omit to let the router choose (F078.2). Set to force one provider — the only way to reach Exa. */
  provider?: SearchProviderId;
  purpose?: SearchPurpose;
  /** Results must be recent / news-like — routes to Brave, the only provider with freshness filters. */
  fresh?: boolean;
  /** Only Zero-Data-Retention providers (customer data in the query). Excludes Exa and Brave. */
  zdr?: boolean;
  /** Attribution on the cost-sink row, e.g. { tenantId }. */
  labels?: Record<string, string>;
}

export interface SearchItem {
  title: string;
  url: string;
  description: string;
  provider: SearchProviderId;
  lang?: string;
  /** ISO timestamp when the provider reports one (Brave does; Cloudflare's providers do not). */
  publishedAt?: string;
}

export interface SearchResult {
  items: SearchItem[];
  meta: {
    provider: SearchProviderId;
    latencyMs: number;
    cached: boolean;
    costUsd: number;
    requestId?: string;
  };
}

export interface SearchCredentials {
  braveApiKey?: string;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
}

export interface SearchCache {
  get(key: string): SearchResult | undefined;
  set(key: string, value: SearchResult, ttlMs: number): void;
}

export interface SearchOptions {
  /** false = no cache. Default: one in-process memory cache shared by all calls. */
  cache?: SearchCache | false;
  /** Where each call (and each failed attempt) is recorded. ai.search() passes the client's sink. */
  costSink?: import("../types.js").CostSink;
  /** Explicit keys (BYOK); missing fields fall back to env. */
  credentials?: SearchCredentials;
  /** Injectable fetch (tests, proxies) — same contract as the model adapters (F073). */
  fetch?: typeof fetch;
}

/** Thrown before any request when the provider's key is absent — names the env var to set. */
export class SearchKeyMissingError extends Error {
  constructor(public readonly provider: SearchProviderId, public readonly envVar: string) {
    super(`search: ${provider} needs ${envVar} (env or options.credentials)`);
    this.name = "SearchKeyMissingError";
  }
}
