# F018 — Trail-Backed Live Model Inventory

> **INTERIM PLAN — open questions at top, pending Trail's answer (intercom #3085).** Mirror the F017 model inventory into Trail (the fleet's knowledge base for chatbots) so it becomes a **live, conversational, queryable** inventory — fed directly from the monthly GHA run. JSON stays v1 / the deterministic source; Trail is the query layer on top. Tier: tooling/integration. Effort: M (est., firms up after Trail replies). Status: planned (blocked on Trail's design input).

## Open Questions (BLOCKING — resolve with Trail before building)
Sent to Trail as #3085; their answers shape every story below:
1. **Fit** — are ~350 structured model-entries (refreshed monthly) a good Trail KB, or is Trail mainly for free-text knowledge?
2. **Ingest from GHA** — is there an ingest API (endpoint + key) the monthly GitHub Action can POST to directly? What document format (one markdown doc per model? JSON? one big doc)?
3. **Query/MCP** — how do I query it conversationally — via Trail MCP? Which tools? What `.mcp.json` config (URL + key) do I add to ai-sdk so this session can "chat" with the inventory?
4. **Tenant/KB** — a dedicated `model-inventory` tenant/KB?
5. **JSON vs Trail** — replacement or complementary? (Working assumption: complementary — JSON = deterministic source for `recommendModel()`, Trail = conversational query layer + cross-repo chat surface.)

## Motivation

F017 gives a deterministic JSON inventory + a `recommendModel()` advisor. Great for structured, auditable recommendations. But Christian's insight: Trail is *purpose-built* as a knowledge base for chatbots — so hosting the inventory there could make it a **living** thing you (and other repos) can chat with in natural language ("what's the cheapest EU model that does vision and tools?"), kept current by feeding new data straight from CI. The JSON answers structured queries; Trail answers conversational ones and becomes the shared, always-fresh source other repos consult.

## Solution (sketch — pending Trail)

Keep `inventory.json` as the deterministic v1 source. Add a pipeline that pushes the inventory into a dedicated Trail knowledge base (one document per model, or per Trail's recommended shape) directly from the monthly GHA run. Install Trail's MCP in this repo so the ai-sdk session can query the KB conversationally. The advisor can then consult Trail (conversational) in addition to the JSON (deterministic).

## Scope

### In scope (provisional)
- Trail MCP wired into ai-sdk's `.mcp.json` so this session can query the inventory KB.
- A GHA step (extends the F017.5 monthly run) that delivers the enriched inventory into Trail's ingest API.
- A script that knows the Trail contract (format, endpoint, tenant/KB) — `scripts/push-inventory-to-trail.ts`.
- Doc of the conversational query path (how the advisor / other repos consult the Trail KB).

### Out of scope
- Removing the JSON inventory — it stays the deterministic source for `recommendModel()`.
- Building Trail features themselves (ingest API, KB schema) — that's Trail's repo; F018 consumes Trail's surface.
- Trail becoming the cost-of-record — cost stays the SDK's pricing table.

## Architecture (to confirm with Trail)
- **Ingest**: monthly GHA → `scripts/push-inventory-to-trail.ts` → Trail ingest API (endpoint + per-tenant key as a GHA secret). Format per Trail's answer (likely one markdown doc per model with frontmatter: price, region, modality, goodFor).
- **Query**: Trail MCP tools (`trail_search` / chat) loaded in ai-sdk's `.mcp.json` → the model-advisor skill can consult Trail for fuzzy/conversational questions, falling back to / cross-checking the JSON.
- **Freshness**: same monthly cadence as F017.5; new models flow into Trail automatically.

## Stories (provisional — finalize after Trail #3085)
- **F018.1** — Wire Trail MCP into ai-sdk `.mcp.json` (URL + key from Trail) so the session can query the inventory KB.
- **F018.2** — `scripts/push-inventory-to-trail.ts` — deliver the enriched inventory into Trail's ingest API in the agreed format.
- **F018.3** — Extend the monthly GHA run (F017.5) to push to Trail after building inventory.json.
- **F018.4** — Query path: model-advisor skill consults the Trail KB conversationally (complementary to the JSON), documented.

## Acceptance criteria
1. The inventory exists as a queryable Trail KB, fed from the monthly GHA run (not hand-uploaded).
2. The ai-sdk session can ask the Trail KB a natural-language model question and get a grounded answer (live-verified once Trail MCP is wired).
3. The JSON inventory + `recommendModel()` keep working unchanged (Trail is additive).
4. A new model from the monthly run appears in Trail within that run (freshness proven, not assumed).

## Dependencies
- **F017** (the JSON inventory + monthly run) — F018 mirrors/extends it.
- **Trail** — ingest API + MCP + the design answers in #3085. Hard dependency; F018 can't start until Trail confirms the approach.

## Rollout
Complementary + additive — the JSON path never breaks. Phase: (1) confirm design with Trail, (2) wire MCP + push script, (3) extend the monthly run, (4) advisor consults Trail. Rollback = stop pushing / unwire MCP; JSON inventory is untouched.

## Effort estimate
**M (estimate)** — ~2 days once Trail's contract is known; could shrink if Trail's ingest is a simple POST.
