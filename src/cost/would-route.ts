// F056.2 — "where WOULD this land?", answered before the call.
//
// THE NAME IS THE DESIGN. components' rule, and they shipped the same shape in
// @broberg/mail the day they said it: "a forecast that can be wrong must not have the
// form of a fact that cannot." `usage.region` is a FACT — the route that actually
// answered. This is a FORECAST. Two fields called `region` with different truth values
// is the exact failure this package spent F055 removing, so the returned shape carries
// no field called `region` at all.
import { DEFAULT_BASE_URLS, CONFIG_DERIVED_HOSTS, LOCALLY_PINNED_HOSTS } from "./default-hosts.js";
import { regionOfHost, type Region } from "./region.js";
import { DEFAULT_TIER_MAP } from "../routing/tier-map.js";
import type { Tier } from "../types.js";

/** What a forecast can say. `"depends-on-config"` is NOT a region — it is the honest
 *  answer for a provider whose host you supply part of (azure, vertex, deepl, requesty,
 *  fal). `requesty` is why it exists: it has both an EU and a non-EU host, so a table
 *  answering there would be a residency claim decided by a table rather than by a route. */
export type RouteForecast =
  | {
      kind: "forecast";
      /** The provider the tier resolves to today. */
      provider: string;
      /** The host the SDK would use if you override nothing. */
      host: string;
      /** Region of THAT host. Only `"eu"` is a positive claim — `"unknown"` means we
       *  cannot say, never "probably fine". */
      wouldRouteTo: Region;
      /** The assumptions, returned WITH the answer rather than left in the docs. Never
       *  empty: a forecast whose conditions are invisible reads as a fact. */
      onlyIf: string[];
    }
  | {
      kind: "depends-on-config";
      provider: string;
      /** Why no table can answer for this provider. */
      because: string;
      onlyIf: string[];
    }
  | {
      kind: "unknown-provider";
      provider: string;
      onlyIf: string[];
    };

const ASSUMPTIONS = [
  "you do not set your own baseUrl — we cannot know where your gateway forwards to",
  "you pass no fallback: a fallback IS a route, and the route decides residency",
  "you pass no override that changes the provider",
];

/** Forecast for a PROVIDER, using the host the SDK would default to. */
export function wouldProviderRouteTo(provider: string): RouteForecast {
  const onlyIf = [...ASSUMPTIONS];
  const host = DEFAULT_BASE_URLS[provider as keyof typeof DEFAULT_BASE_URLS] ?? LOCALLY_PINNED_HOSTS[provider];
  if (host) {
    // regionOfHost, never regionOfProvider: a NAME cannot answer for residency when the
    // provider takes a baseUrl, which is why regionOfProvider("mistral") is "unknown" and
    // a guard built on it rejects the only EU route we have. The HOST can answer.
    return { kind: "forecast", provider, host, wouldRouteTo: regionOfHost(host), onlyIf };
  }
  const because = CONFIG_DERIVED_HOSTS[provider];
  if (because) return { kind: "depends-on-config", provider, because, onlyIf };
  return { kind: "unknown-provider", provider, onlyIf };
}

/** Forecast for a TIER — the question helpdesk actually asked. */
export function wouldRouteTo(tier: Tier): RouteForecast {
  const spec = DEFAULT_TIER_MAP[tier];
  if (!spec) return { kind: "unknown-provider", provider: String(tier), onlyIf: [...ASSUMPTIONS] };
  return wouldProviderRouteTo(spec.provider);
}
