// F078 — web search as a shared capability (SEARCH-PLAN, Christian 2026-10-09).
// One request shape, one result shape, whichever provider answers. Apps import
// `search` from @broberg/ai-sdk and never talk to a search provider directly.

/** `tavily` is CMS-legacy only (F078.5): reachable by explicit provider, never routed to. */
export type SearchProviderId = "brave" | "cloudflare:ceramic" | "cloudflare:linkup" | "cloudflare:exa" | "tavily";

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
  /** AI Gateway the search runs through. Default "default" (env CLOUDFLARE_GATEWAY_ID). */
  cloudflareGatewayId?: string;
  tavilyApiKey?: string;
}

export interface SearchCache {
  get(key: string): SearchResult | undefined;
  set(key: string, value: SearchResult, ttlMs: number): void;
}

/** Running spend per key (tenant + day). Async allowed, so it can live in a database.
 *  `reserve` must CHECK AND ADD in one atomic step (e.g. `UPDATE … SET spent = spent + ?
 *  WHERE spent + ? <= cap`) and say whether it fitted — a separate read-then-write lets
 *  parallel calls all pass a cap only one of them fits under. `release` gives a
 *  reservation back when the call fails. */
export interface SearchCapStore {
  reserve(key: string, usd: number, capUsd: number): boolean | Promise<boolean>;
  release(key: string, usd: number): void | Promise<void>;
  getSpent(key: string): number | Promise<number>;
}

export interface SearchOptions {
  /** false = no cache. Default: one in-process memory cache shared by all calls. */
  cache?: SearchCache | false;
  /** Where each call (and each failed attempt) is recorded. ai.search() passes the client's sink. */
  costSink?: import("../types.js").CostSink;
  /** Explicit keys (BYOK); missing fields fall back to env — unless `byok` is set. */
  credentials?: SearchCredentials;
  /** F078.3 — customer-key mode: keys come ONLY from `credentials`, env is never read,
   *  so a tenant whose key is missing cannot run on the fleet's account. */
  byok?: boolean;
  /** F078.3 — hard ceiling in USD per tenant (`labels.tenantId`) per calendar day in
   *  Europe/Copenhagen. A call that would cross it throws before any request. */
  dailyCapUsd?: number;
  /** Where the day's spend is kept. Default: in-process memory shared by all calls. */
  capStore?: SearchCapStore;
  /** Clock for the day boundary (tests). */
  now?: () => Date;
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

/** Thrown before any request when the tenant's daily ceiling would be crossed. */
export class SearchBudgetExceededError extends Error {
  constructor(public readonly tenant: string, public readonly day: string, public readonly capUsd: number, public readonly spentUsd: number, public readonly requestedUsd: number) {
    super(`search: daily cap $${capUsd} for tenant "${tenant}" on ${day} reached ($${spentUsd.toFixed(5)} spent, this call $${requestedUsd})`);
    this.name = "SearchBudgetExceededError";
  }
}
