// F078.2 — which provider(s) answer a search, as DATA so a tenant can override it.
// Rules from SEARCH-PLAN §5 (Christian 2026-10-09). First matching rule wins; its
// chain is tried in order. ZDR filtering runs after, so a rule never has to repeat it.
import type { SearchProviderId, SearchRequest } from "./types.js";

export interface SearchRoute {
  /** Readable name — shows up in tests and in the reason a provider was picked. */
  name: string;
  when: { fresh?: boolean; english?: boolean; purpose?: SearchRequest["purpose"][] };
  chain: SearchProviderId[];
}

export const DEFAULT_SEARCH_ROUTES: SearchRoute[] = [
  { name: "fresh-or-country", when: { fresh: true }, chain: ["brave", "cloudflare:linkup"] },
  { name: "english-agent", when: { english: true, purpose: ["agent", "grounding"] }, chain: ["cloudflare:ceramic", "cloudflare:linkup", "brave"] },
  { name: "english-other", when: { english: true }, chain: ["cloudflare:linkup", "cloudflare:ceramic", "brave"] },
  { name: "non-english", when: {}, chain: ["cloudflare:linkup", "brave"] },
];

/** Providers that keep no data (Cloudflare docs, 2026-10-09). Brave's standard plan logs 90 days. */
export const ZDR_PROVIDERS = new Set<SearchProviderId>(["cloudflare:ceramic", "cloudflare:linkup"]);

const isEnglish = (lang?: string) => !lang || /^en\b/i.test(lang);

export function routeSearch(req: SearchRequest, routes: SearchRoute[] = DEFAULT_SEARCH_ROUTES): SearchProviderId[] {
  if (req.provider) {
    // zdr is a promise about customer data; an explicit provider must not quietly break it.
    if (req.zdr && !ZDR_PROVIDERS.has(req.provider)) {
      throw new Error(`search: zdr:true but provider "${req.provider}" keeps query data — use cloudflare:ceramic or cloudflare:linkup`);
    }
    return [req.provider]; // an explicit choice is honoured as-is, Exa included
  }
  const fresh = Boolean(req.fresh || req.country);
  const english = isEnglish(req.lang);
  const route = routes.find((r) =>
    (r.when.fresh === undefined || r.when.fresh === fresh) &&
    (r.when.english === undefined || r.when.english === english) &&
    (r.when.purpose === undefined || r.when.purpose.includes(req.purpose ?? "agent")),
  ) ?? routes[routes.length - 1]!;
  // Ceramic is English-only: never route a non-English query to it, whatever a custom table says.
  let chain = route.chain.filter((p) => english || p !== "cloudflare:ceramic");
  // Exa has no Zero Data Retention: never chosen by the router, only by explicit provider.
  chain = chain.filter((p) => p !== "cloudflare:exa");
  if (req.zdr) chain = chain.filter((p) => ZDR_PROVIDERS.has(p));
  return chain;
}
