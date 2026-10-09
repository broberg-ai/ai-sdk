// F078.2 — a repeated agent search should not be paid for twice. In-process memory
// cache by default; lifetime by purpose (SEARCH-PLAN §6: short for monitor, long for
// discovery). grounding's lifetime is an open question in the plan — 1 h until decided.
import type { SearchCache, SearchRequest, SearchResult } from "./types.js";

export const SEARCH_CACHE_TTL_MS: Record<NonNullable<SearchRequest["purpose"]>, number> = {
  monitor: 5 * 60_000,
  agent: 60 * 60_000,
  grounding: 60 * 60_000,
  discovery: 7 * 24 * 60 * 60_000,
};

export function searchCacheKey(provider: string, req: SearchRequest): string {
  const q = req.query.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  return JSON.stringify([provider, req.lang ?? "", req.country ?? "", req.limit ?? 10, q]);
}

export function memorySearchCache(max = 1000): SearchCache {
  const m = new Map<string, { v: SearchResult; until: number }>();
  return {
    get(k) {
      const e = m.get(k);
      if (!e) return undefined;
      if (Date.now() > e.until) { m.delete(k); return undefined; }
      return e.v;
    },
    set(k, v, ttlMs) {
      if (m.size >= max) m.delete(m.keys().next().value!); // oldest first
      m.set(k, { v, until: Date.now() + ttlMs });
    },
  };
}
