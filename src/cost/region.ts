// F042 — where did the data actually go?
//
// The obvious implementation of this file is a table keyed on provider name, and it
// would LIE for three of our adapters in the direction that matters. vertex, azure and
// bfl are EU by default and by intent — that is why they exist — but each takes an
// override (a GCP region, an Azure region, a base URL), so a consumer can point them
// outside the EU while the provider name stays the same. A residency field that is
// right by default and wrong precisely when someone changed something is worse than no
// field at all, because it gets trusted.
//
// So the rule here is: the region is a property of the ENDPOINT WE CALLED. For the
// adapters whose host is fixed in code, that derivation collapses to a constant (this
// file). For the three that vary, the adapter passes the locator it actually used.

/** Coarse data-residency of the endpoint a call went to.
 *
 *  - `"eu"`  — EU/EEA. **The only positive residency claim.** Nothing else is folded
 *              in: an adequacy decision is not EU residency, so the UK, Switzerland
 *              and Canada are deliberately NOT `"eu"` here.
 *  - `"us"`  — United States.
 *  - `"cn"`  — China.
 *  - `"unknown"` — we genuinely cannot say: an aggregator that picks its own upstream,
 *              or a region string we do not recognise.
 *
 *  **`"unknown"` is NOT a synonym for safe.** `region !== "us"` is not an EU check —
 *  it passes every OpenRouter call. Only `region === "eu"` may be treated as EU-resident.
 */
export type Region = "eu" | "us" | "cn" | "unknown";

/** Region by HOST — the primary derivation, because it reads the thing that actually
 *  decides: the URL we are about to call.
 *
 *  The first version of this module keyed on provider NAME and carved out three
 *  adapters as "the configurable ones". That carve-out was wrong: `mistralAdapter`
 *  and `deeplAdapter` also take a `baseUrl`, so pointing Mistral — our designated
 *  personal-data route — at a non-EU gateway still reported `region: "eu"`. A false
 *  EU claim, in the module written to prevent false EU claims. Found in review of
 *  F042 itself, which is the honest place to record it.
 *
 *  An unlisted host is "unknown", never a guess: a custom gateway is exactly the case
 *  where we cannot know, and the whole contract is that only "eu" is a claim. */
const HOST_REGION: Record<string, Region> = {
  "api.mistral.ai": "eu",
  "api.deepl.com": "eu",
  "api-free.deepl.com": "eu",
  "api.eu.bfl.ai": "eu",
  "api.openai.com": "us",
  "api.anthropic.com": "us",
  "api.deepinfra.com": "us",
  "generativelanguage.googleapis.com": "us",
  "api.elevenlabs.io": "us",
  "fal.run": "us",
  "queue.fal.run": "us",
  "api.deepseek.com": "cn",
  // Aggregators: the host is theirs, the upstream is not ours to know.
  "openrouter.ai": "unknown",
  "router.requesty.ai": "unknown",
};

/** Region of the endpoint a call will actually hit. Never throws — a residency
 *  reading must not be able to break a call that already succeeded. */
export function regionOfHost(url: string | undefined): Region {
  if (!url) return "unknown";
  try {
    const host = new URL(url).host.toLowerCase();
    return Object.hasOwn(HOST_REGION, host) ? (HOST_REGION[host] as Region) : "unknown";
  } catch {
    return "unknown";
  }
}

/** Adapters whose endpoint is FIXED in code — there is no config that moves them, so
 *  the provider name IS the region. Anything absent here must pass its region
 *  explicitly; the fallback is `"unknown"`, never a guess in the reassuring direction. */
const FIXED_PROVIDER_REGION: Record<string, Region> = {
  // NB: mistral and deepl are deliberately ABSENT — both take a config.baseUrl, so
  // their region is a property of the URL, not of the name. They derive via
  // regionOfHost. Anything left here genuinely cannot be moved by config.
  openai: "us",
  anthropic: "us",
  // generativelanguage.googleapis.com is Google's GLOBAL endpoint, not a US-pinned one.
  // We report "us" rather than "unknown" because it is certainly not EU-resident, and
  // the honest error direction for a residency field is away from an EU claim. Vertex
  // (below, region-pinned) is the route to use when EU residency is required.
  gemini: "us",
  deepinfra: "us",
  fal: "us",
  elevenlabs: "us",
  // api.deepseek.com — People's Republic of China. No EU adequacy decision at all,
  // which is a materially different position from the US, hence its own value.
  deepseek: "cn",
  // Aggregators: they choose the upstream provider per request, so the region is not
  // ours to know. Reporting anything else here would be inventing a fact.
  openrouter: "unknown",
  requesty: "unknown",
};

/** GCP + Azure region names we recognise as EU/EEA. Norway is EEA and counts.
 *  Switzerland and the UK are deliberately absent — adequate, but not EU/EEA. */
const EU_REGION_NAMES = new Set([
  // Azure
  "westeurope",
  "northeurope",
  "swedencentral",
  "francecentral",
  "francesouth",
  "germanywestcentral",
  "germanynorth",
  "norwayeast",
  "norwaywest",
  "polandcentral",
  "italynorth",
  "spaincentral",
]);

const US_REGION_NAMES = new Set([
  // Azure
  "eastus",
  "eastus2",
  "westus",
  "westus2",
  "westus3",
  "centralus",
  "northcentralus",
  "southcentralus",
  "westcentralus",
]);

/** Classify a provider REGION STRING — a Vertex/GCP location like `europe-west1`, or
 *  an Azure region like `westeurope`. Anything unrecognised is `"unknown"`: a region
 *  name we have never seen is exactly the case where guessing is most tempting and
 *  least defensible. Never throws — a residency reading must not be able to break a
 *  call that already succeeded. */
export function classifyRegionName(name: string | undefined): Region {
  if (!name) return "unknown";
  const n = name.trim().toLowerCase();
  if (!n) return "unknown";
  // GCP-style: europe-west1, europe-north1, us-central1, …
  if (n.startsWith("europe-")) return "eu";
  if (n.startsWith("us-")) return "us";
  if (EU_REGION_NAMES.has(n)) return "eu";
  if (US_REGION_NAMES.has(n)) return "us";
  return "unknown";
}

/** Region for an adapter whose endpoint is fixed. Unknown provider → `"unknown"`.
 *
 *  **DO NOT BUILD A RESIDENCY GUARD ON THIS.** Use {@link regionOfHost} on the base URL
 *  the call will actually use. Found by a consumer building exactly that guard (super,
 *  2026-08-30): `regionOfProvider("mistral")` is `"unknown"` — correct, because Mistral
 *  takes a `baseUrl` and a name cannot answer for residency — but a guard written as
 *  `regionOfProvider(p) === "eu"` therefore REJECTS Mistral, which is the only EU route
 *  we have. It fails closed and is useless: it filters out the thing it exists to allow.
 *
 *  The trap is invisible from the signature, which is why it is written here rather than
 *  only in the docs. This function answers "is this provider's endpoint fixed, and where
 *  is it?" — a narrower question than "where will my call go?". */
export function regionOfProvider(provider: string): Region {
  // Object.hasOwn, NOT a bare lookup + ??. A plain object inherits from
  // Object.prototype, so FIXED_PROVIDER_REGION["constructor"] returns a FUNCTION and
  // the ?? fallback never fires — putting a function where a Region belongs. It fails
  // safe against `region === "eu"`, but it serialises to nothing, so a cost sink would
  // record a Usage with no region at all: a missing value that does not look like one,
  // in the very feature built to stop that. Not reachable today (every caller passes a
  // hardcoded adapter name) — fixed because "not reachable yet" is not a property we
  // control from here.
  return Object.hasOwn(FIXED_PROVIDER_REGION, provider)
    ? (FIXED_PROVIDER_REGION[provider] as Region)
    : "unknown";
}
