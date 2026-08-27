# F042 — `usage.region`: say where the data actually went

> **Status: in progress.** Requested by **components** as the single remaining blocker
> for `@broberg/chat` (watchdog #15589, open since 2026-08-11 with no date promised).
> This doc is written before the code.

## The gap

CLAUDE.md already tells every consumer in the fleet:

> **`resolveModel` does NOT tell you where data goes.** It reports provider + model,
> never region … For residency, read `usage.provider`/`usage.model` off the RESPONSE.

That instruction is correct and **not actually followable**. Reading `provider: "vertex"`
off a response tells a caller nothing about residency, because the mapping from
(provider, model) to a region exists in no machine-readable place — only in this file's
prose and in a reader's memory. So the fleet's residency story currently depends on
every consumer independently knowing which of our fourteen adapters are EU.

For a repo whose designated purpose includes routing **client, personal and health
data** (Mistral is the GDPR provider per the 2026-06-04 assessment; FysioDK, LHD and
Web House SaaS all sit downstream), "the consumer is expected to remember" is not a
residency control.

## The finding that shapes the design

The obvious implementation is a lookup table keyed on provider name. **It would lie,
for three of our adapters, in the direction that matters.**

| adapter | region source | default | can a consumer change it? |
|---|---|---|---|
| `vertex` | `config.location` / `VERTEX_LOCATION` | `europe-west1` | **yes** — any GCP region |
| `azure` | `config.region` / `AZURE_SPEECH_REGION` | `westeurope` | **yes** — any Azure region |
| `bfl` | `config.baseUrl` | `https://api.eu.bfl.ai` | **yes** — incl. the global US-failover host |

All three are EU *by default and by intent* — that is literally why the Vertex adapter
and the BFL EU pin exist. But each takes an override, and a provider-name table would
report `eu` for a call that a consumer had pointed at `us-central1`, `eastus`, or
`api.bfl.ai`. **A residency field that is right by default and wrong exactly when
someone changed something is worse than no field**, because it is trusted.

So: **the region is derived from the endpoint the call actually used**, not from the
provider's name. For the eleven adapters whose host is fixed in code, that derivation
is a constant; for these three it reads the same variable the request did.

## Scope

- **`usage.region`** on the `Usage` type: `"eu" | "us" | "cn" | "unknown"`.
  - `"eu"` means **EU/EEA**. Nothing else is folded into it — an adequacy decision is
    not EU residency, and a caller who needs that distinction needs to see it.
  - `"unknown"` is returned for aggregators (`openrouter`, `requesty` — they route to
    whichever upstream they like, so we genuinely cannot answer) and for any region
    string we do not recognise.
- Derivation in `src/cost/region.ts`, consumed by `freshUsage()` so **every** adapter
  gets the field without each one reimplementing it. The three variable-region adapters
  pass the locator they actually used.
- A recognised-prefix list for GCP/Azure region names; anything unmatched → `"unknown"`.

### `"unknown"` is NOT a synonym for safe

This is the single most likely way for this feature to cause harm rather than prevent
it. A consumer writing `if (usage.region !== "us") allowPersonalData()` gets a green
light on every OpenRouter call. The field's contract is: **only `"eu"` is a positive
residency claim.** Documented on the type, in CLAUDE.md, and asserted in a test so the
intent survives someone "tidying" the union later.

### Non-goals

- **Not a guard.** It reports; it does not refuse. Christian settled this on 2026-08-11
  when asked whether the SDK should block non-EU routes for personal data: *"Nej — lad
  kalderen selv passe på"* (no — the caller's responsibility). This epic gives the
  caller the fact they need to exercise that responsibility; it does not take the
  decision away from them.
- **No per-model regions.** Region is a property of the endpoint we called, not of the
  weights. A model served from two regions is two routes, and the route is what we report.
- **No change to routing.** No tier moves; `video` and `embedding` still leave the EU and
  this feature's job is to make that *visible*, not to fix it.
- Not a claim about sub-processors. We report the host we sent bytes to. What a provider
  does downstream is their DPA's business, not something the SDK can observe.

## Reuse

Checked before planning — `GET discovery.broberg.ai/api/search?q=region+residency+gdpr`:
no `@broberg/*` package owns provider metadata or data-residency classification. This
repo is the fleet's AI primitive and the Model Advisor authority (F017), and it is the
only place that knows which endpoint a call went to. Nothing external to reuse; the
capability belongs here.

## Stories

| | |
|---|---|
| **F042.1** | `region` derived from the endpoint actually used, on every adapter's `Usage` |

## Consumers waiting

- **components / `@broberg/chat`** — named this as their blocker. Tell them the version
  the day it publishes, **as a dated measurement** ("as of <date>, `usage.region`
  reports …"), never as a permanent state — that is the phrasing rule three stale
  Discovery notes in one week earned us.
- **fd-sundhed** — health data; the residency question was left explicitly unresolved
  between them and this repo. This field is the fact that closes it.
