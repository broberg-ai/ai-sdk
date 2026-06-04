# F018 — Model-Selection Narrative Knowledge Base (Trail)

> **REVISED 2026-06-04 per Trail's expert verdict (intercom #3103).** Original idea was to mirror the F017 inventory *table* into Trail; Trail correctly rejected that (deterministic price data must not go through RAG; monthly refresh would spam the contradiction-lint). Revised scope: keep the JSON as the authoritative source, and use Trail for what it's actually good at — a **curated, accumulating free-text knowledge base of model-selection wisdom** (philosophy, provider quirks, lessons-learned) that the advisor consults for the "why" layer. Tier: tooling/integration. Effort: S–M. Status: planned (light dependency on Trail's `.mcp.json` snippet, requested in #3112).

## Why the pivot (Trail #3103, verbatim gist)
- **JSON stays source-of-truth.** 346 entries with precise numbers (price/token, context, GDPR-region) are *deterministic* data. RAG retrieves text-chunks → an LLM could paraphrase/round a price wrong, and `recommendModel()` must never build on a guess.
- **Monthly refresh would be noise.** Every price change would trip Trail's contradiction-lint as a "contradiction" — pure churn on every run. Trail shines on *accumulating* knowledge, not a fast-changing catalogue.
- **"Chatting with the inventory" needs no Trail.** 346 entries fit in a context window → the `model-advisor` skill already injects `inventory.json` directly. No vector/RAG needed for table queries.
- **Where Trail adds real value:** a slowly-changing *narrative* KB about model-selection — a different artifact from the table.

## Motivation

F017 answers *what* (the deterministic table + `recommendModel()`). But there's real, accumulating wisdom that isn't a number and doesn't belong in a JSON row: "medium-3.5 is a premium coding tier — don't default to it"; "OpenRouter slugs use dots, the dashed forms silently mismatch"; "GDPR is a hard gate for personal data, not a preference"; "Mistral Large 3 is the cheap frontier default now". This is free-text that grows over time as we learn — Trail's sweet spot. Captured there, the advisor (and other repos) can consult the *why/philosophy* layer on top of the *what* numbers.

## Solution

A dedicated Trail knowledge base ("model-selection") holding curated, free-text lessons-learned + provider quirks + selection philosophy. The `model-advisor` skill consults it for the qualitative layer, while `inventory.json` + `recommendModel()` remain the authoritative quantitative source. New lessons are written to Trail as they emerge (via `mcp__trail__write`). No table mirroring; no per-model Neurons.

## Scope

### In scope
- Trail MCP wired into ai-sdk `.mcp.json` (`mcp__trail__write` + `mcp__trail__search`) — config from Trail (#3112).
- Seed the narrative KB with the lessons we already have (see below).
- The `model-advisor` skill consults the Trail narrative KB for the "why" layer, complementary to the JSON.
- A lightweight habit/step: when the monthly run or a session surfaces a new model-selection lesson, write it to the KB.

### Out of scope (explicitly — Trail rejected these)
- Mirroring the 346-entry inventory *table* into Trail as Neurons.
- Pushing the changing price/availability data into Trail from GHA (stays in `inventory.json`).
- RAG/vector over the inventory numbers — the table fits in context; the skill injects it directly.
- Trail as a source for `recommendModel()` — that function reads JSON only (deterministic).

## Architecture
- **KB**: a `model-selection` KB under the broberg-ai tenant in Trail (free-text Neurons: one per lesson/quirk/philosophy note).
- **Write**: `mcp__trail__write` from this session (and optionally a step in the monthly run when a new lesson is detected).
- **Query**: the `model-advisor` skill calls `mcp__trail__search` for the qualitative layer ("any quirks/lessons for <model/provider>?"), then combines with the JSON numbers for the final recommendation.
- **Boundary**: numbers → JSON (authoritative); narrative → Trail (advisory). The advisor never lets a Trail-retrieved sentence override a JSON price.

## Seed lessons (initial KB content)
- medium-3.5 is a premium coding tier ($1.5/$7.5); Large 3 ($0.5/$1.5) is the cheaper frontier default.
- OpenRouter slugs use dots (`claude-haiku-4.5`); dashed forms silently mismatch → $0 cost (F014 finding).
- GDPR is a hard gate for personal/client data → EU-hosted (Mistral) only ([[mistral-is-gdpr-provider]]).
- Mistral OCR is per-page, EU-hosted — right for patient documents.
- Voxtral = the GDPR-safe audio path (transcribe + TTS).
- F010 ground-truth cost overrides the table for OpenRouter routes.

## Stories
- **F018.1** — Wire Trail MCP into ai-sdk `.mcp.json` (write + search), config from Trail (#3112); verify the session can read/write the `model-selection` KB.
- **F018.2** — Seed the narrative KB with the lessons above via `mcp__trail__write`.
- **F018.3** — `model-advisor` skill consults the Trail KB (`mcp__trail__search`) for the qualitative "why" layer, combined with the JSON numbers; numbers always authoritative.
- **F018.4** — Capture-new-lessons habit: a documented step (manual + optionally in the monthly run) to write a new model-selection lesson to the KB when one surfaces.

## Acceptance criteria
1. Trail MCP is wired in ai-sdk; the session can `mcp__trail__write` + `mcp__trail__search` the `model-selection` KB (live-verified).
2. The KB is seeded with the lessons above; a search for e.g. "mistral medium 3.5" returns the premium-tier lesson.
3. The `model-advisor` skill cites a relevant Trail lesson alongside the JSON numbers when one exists — and the numbers always come from JSON, never Trail.
4. The JSON inventory + `recommendModel()` are unchanged and still authoritative.

## Dependencies
- **F017** (JSON inventory + advisor skill) — F018 layers narrative on top.
- **Trail** — `.mcp.json` config (URL+key) requested in #3112; the ingest/RAG table approach is explicitly dropped per #3103.

## Rollout
Additive + low-risk — the JSON path is untouched. Phase: wire MCP → seed KB → skill consults it → capture-habit. Rollback = unwire MCP; nothing else depends on it.

## Effort estimate
**S–M** — ~1 day once Trail's `.mcp.json` snippet lands (mostly seeding + a skill tweak). Smaller than the original table-mirror idea precisely because we're not fighting RAG over deterministic data.
