// F078.1 — USD per search request. Read 2026-10-09: developers.cloudflare.com/web-search/providers
// (Ceramic $0.25, Linkup $5, Exa $7 per 1,000) and brave.com/search/api ($5 per 1,000).
import type { SearchProviderId } from "./types.js";

export const SEARCH_PRICE_USD: Record<SearchProviderId, number> = {
  "cloudflare:ceramic": 0.00025,
  "cloudflare:linkup": 0.005,
  "cloudflare:exa": 0.007,
  brave: 0.005,
  // 1 credit per basic search; $0.0075/credit on the entry plan, less on bigger plans
  // (docs.tavily.com/documentation/api-credits, 2026-10-09).
  tavily: 0.0075,
};
