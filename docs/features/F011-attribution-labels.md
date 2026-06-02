# F011 — Per-call attribution labels (multi-tenant cost)

> Status: planned (contract pending) · Epic · Priority: high
> Surfaced by: trail F190.5 via Christian (2026-06-02). 3-system contract: ai-sdk + upmetrics + trail.

## Open questions (resolve with upmetrics + trail BEFORE building)

1. **Wire field shape** — top-level `labels: Record<string,string>` on `POST /api/agent`, or merged into the existing `tags`? (tags today carry capability/transport/sdk — low-cardinality, SDK-owned. labels are consumer-defined, higher-cardinality, queryable — likely a distinct field.)
2. **upmetrics storage** — indexed for `GROUP BY` on a label key? Cardinality limits / allowed key whitelist?
3. **/api/cost/summary** — `?groupBy=<labelKey>` + `?<labelKey>=<value>` filter? Returns per-label breakdown?
4. **trail consumer** — confirms it passes `labels:{tenantId, kbId?}` per call + scopes the F151 panel per-tenant (engine-wide totals operator-only).

## Motivation

Cost flows: SDK call → `upmetricsSink` → `POST /api/agent` → `agent_runs` tagged `agentName=<project>` (engine-wide). For a multi-tenant engine (trail serves many tenants/KBs under one project) there is **no per-tenant axis** — all tenants collapse into one number. So a per-KB cost panel would leak cross-tenant spend. trail correctly flagged this rather than shipping a leaky panel.

Running one upmetrics account per tenant is the wrong fix (operational nightmare, breaks the single-engine model). The **missing piece is a per-call attribution dimension** that flows SDK → upmetrics and can be queried. The SDK owns the `Usage`→sink contract, so it is the right layer to introduce it; upmetrics stores+queries it; the consumer passes it.

## Design (decided: generic labels map)

Christian chose a **generic `labels: Record<string,string>`** over a dedicated `tenantId` field — `tenantId` is just one label, and any multi-tenant consumer (cms, buddy) gets per-customer cost for free.

- **SDK input** — add `labels?: Record<string,string>` to the shared `callOptions` (so every capability: chat/chatStream/vision/translate/image/embedding/transcribe/contracts accepts it).
- **Usage** — add `labels?: Record<string,string>`; the client `enrich()` stamps `input.labels` onto the Usage.
- **upmetricsSink** — forward `labels` on the POST body (exact field per Q1). Other sinks (sqlite/discord) may store/ignore as they see fit.
- **upmetrics** — store as an indexed dimension on `agent_runs`; `/api/cost/summary` supports group-by/filter (Q2/Q3).
- **Consumer (trail)** — `ai.chat({…, labels:{tenantId:…, kbId:…}})`; F151 panel queries per-tenant; engine-wide totals operator-gated.

### Non-goals

- No per-tenant upmetrics accounts (explicitly rejected).
- No PII in labels — ids only (consumer's responsibility).
- SDK does not validate label semantics — free `Record<string,string>`; upmetrics may whitelist keys it indexes.
- No change to existing `tags` (capability/transport/sdk) or `purpose`.

## Stories

| # | Title | Gist |
|---|---|---|
| F11.1 | `labels` on CallOptions → Usage → upmetricsSink | Zod field on shared callOptions + Usage.labels + enrich stamps it + upmetricsSink forwards it (wire field per locked contract) + tests |

## Rollout

Lock the wire contract with upmetrics + trail (open questions) → build SDK side (F11.1) + upmetrics side in parallel → publish minor → trail passes labels + ships the per-tenant panel.
