// F078 — web search as a shared capability (SEARCH-PLAN, Christian 2026-10-09).
// One request shape, one result shape, whichever provider answers. Apps import
// `search` from @broberg/ai-sdk and never talk to a search provider directly.

export type SearchProviderId = "brave" | "cloudflare:ceramic" | "cloudflare:linkup" | "cloudflare:exa";

export interface SearchRequest {
  query: string;
  /** BCP-47-ish language of the query ("da", "en"). Routing input (F078.2); Brave also filters on it. */
  lang?: string;
  /** Country hint for providers that filter on it (Brave: "DK"). */
  country?: string;
  /** Max results. Cloudflare caps at 10. */
  limit?: number;
  /** F078.1: required until the router (F078.2) can choose. */
  provider: SearchProviderId;
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

export interface SearchOptions {
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
