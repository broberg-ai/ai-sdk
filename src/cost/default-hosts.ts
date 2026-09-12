// F056.1 — ONE source for every provider's DEFAULT host.
//
// WHY THIS FILE EXISTS, and it is not tidiness. helpdesk asked for a way to know where a
// tier WOULD land before calling. The easy build was a table of hosts inside that new
// function — which would have been a SECOND copy of the URLs already hardcoded in each
// adapter factory. Their own reaction to the measurement is the argument: "I would have
// deleted my hand-rolled list and believed the copy was gone, while it had just moved
// somewhere I had even less reason to look." Our own F030 drift ran three months inside
// this package; a copy in a foreign repo drifts the same way.
//
// So the adapter and the forecast read the SAME constant. A scanner test forbids the
// FORM `baseUrl ?? "https://…"` in any adapter, so a ninth copy cannot be introduced
// quietly.

/** Providers whose default endpoint is a FIXED host. */
export const DEFAULT_BASE_URLS = {
  anthropic: "https://api.anthropic.com",
  deepinfra: "https://api.deepinfra.com/v1/openai",
  deepseek: "https://api.deepseek.com/v1",
  elevenlabs: "https://api.elevenlabs.io/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  mistral: "https://api.mistral.ai/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
} as const;

export type FixedHostProvider = keyof typeof DEFAULT_BASE_URLS;

/** `bfl` is DELIBERATELY ABSENT. Its adapter hard-pins `https://api.eu.bfl.ai` in a local
 *  constant and calls that pin the GDPR crux, non-negotiable — faces and portraits go
 *  through it. Hoisting the value here would make a deliberate pin editable from a shared
 *  file that nine other providers also read, which is a worse trade than one more name for
 *  one URL. It is not a drifting copy either: there is exactly one place, it is just not
 *  this one. The scanner below does not flag it because bfl never used the
 *  `baseUrl ?? "https://…"` form it forbids. */
export const LOCALLY_PINNED_HOSTS: Record<string, string> = {
  bfl: "https://api.eu.bfl.ai",
};

/** Providers whose host is DERIVED FROM CONFIG, so no table can answer for them.
 *
 *  Measured 12 September 2026, and this list is the honest half of F056: a flat
 *  "default host per provider" table would answer for these too, and be wrong in the
 *  GREEN direction — it would say something instead of saying it cannot.
 *
 *  `requesty` is the sharp one: it has BOTH an EU and a non-EU host, so a guess there
 *  would be a residency claim decided by a table rather than by the route. */
export const CONFIG_DERIVED_HOSTS: Record<string, string> = {
  azure: "host comes from your region + resource name",
  vertex: "host comes from your region (europe-west1 by default)",
  deepl: "host differs between the free and paid plans",
  requesty: "has BOTH an EU and a non-EU host — your config decides",
  fal: "uses several hosts depending on the call",
};

export function defaultBaseUrl(provider: string): string | undefined {
  return (DEFAULT_BASE_URLS as Record<string, string>)[provider];
}
