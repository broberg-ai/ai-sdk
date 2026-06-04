# F018 — Model-Selection Narrative Knowledge Base (Trail)

> **REVISED 2026-06-04 per Trail (#3103 scope, #3134 mechanics).** Keep the F017 `inventory.json` as the authoritative deterministic source; use Trail for a **curated, accumulating free-text KB of model-selection wisdom** (philosophy, provider quirks, lessons-learned) that the advisor consults for the "why" layer. Tier: tooling/integration. Effort: S. Status: planned (Trail provisioning the "Model Selection" KB + delivering a scoped key, per #3157).

## Why the pivot (Trail #3103)
- **JSON stays source-of-truth.** 346 entries with precise numbers are deterministic data; RAG could round a price wrong, and `recommendModel()` must never build on a guess.
- **Monthly refresh would be noise** — every price change trips Trail's contradiction-lint. Trail shines on *accumulating* knowledge, not a fast-changing catalogue.
- **"Chatting with the inventory" needs no Trail** — 346 entries fit a context window; the `model-advisor` skill injects `inventory.json` directly.
- **Trail's real value:** a slowly-changing *narrative* KB — a different artifact from the table.

## ⚠️ Mechanics correction (Trail #3134)
**Trail MCP is stdio-local — it spawns a local process and CANNOT reach the cloud-hosted KB.** So a `.mcp.json` with URL+key does NOT work to read/write cloud-Trail from this session or from GHA. Use the **cloud REST API** instead:
- **Write:** `POST {TRAIL_CLOUD_API}/api/v1/knowledge-bases/:kbId/wiki-write` — body `{command:"create"|"str_replace"|"append", path, title, content, tags}`. (Or `POST /api/v1/queue/candidates` `{kind:"external-feed"}` for pending-review.)
- **Chat (RAG):** `POST /api/v1/knowledge-bases/:kbId/chat`.
- **Headers:** `Authorization: Bearer <TRAIL_API_KEY>` + `X-Trail-Tenant: broberg-ai`.
- **Key:** least-privilege, scoped to the one KB; delivered to this repo's gitignored `.env` as `TRAIL_API_KEY` via Trail's daemon-provisioning (sa-PILOT pattern) — never over intercom.
- **Paths:** `/neurons/concepts/` for philosophy, `/neurons/heuristics/` for rules-of-thumb.

## Motivation

F017 answers *what* (the deterministic table + `recommendModel()`). But real, accumulating wisdom isn't a number and doesn't belong in a JSON row: "medium-3.5 is a premium coding tier — don't default to it"; "OpenRouter slugs use dots, dashed forms silently mismatch"; "GDPR is a hard gate for personal data". Free-text that grows over time → Trail's sweet spot. Captured there, the advisor (and other repos) consult the *why* layer on top of the *what* numbers.

## Solution

A dedicated Trail cloud KB ("Model Selection", broberg-ai tenant) holding curated free-text lessons + provider quirks + selection philosophy, written via the cloud REST `wiki-write` API. The `model-advisor` skill consults it (via `/chat` RAG) for the qualitative layer, while `inventory.json` + `recommendModel()` remain the authoritative quantitative source. No table mirroring; no per-model Neurons.

## Scope

### In scope
- A tiny Trail REST client in this repo (`src/catalogue/trail-kb.ts` or a script): `wiki-write` + `chat` against the cloud API, key from `TRAIL_API_KEY`, `X-Trail-Tenant: broberg-ai`.
- Seed the "Model Selection" KB with the lessons below.
- The `model-advisor` skill consults the KB (`/chat`) for the "why" layer, complementary to the JSON.
- A lightweight habit: when a new model-selection lesson surfaces, `wiki-write` it (`/neurons/concepts/` or `/neurons/heuristics/`).

### Out of scope (Trail rejected)
- Mirroring the 346-entry inventory table into Trail as Neurons.
- Pushing changing price/availability data into Trail from GHA (stays in `inventory.json`).
- RAG/vector over the inventory numbers — the table fits in context; the skill injects it directly.
- Trail MCP via `.mcp.json` — stdio-local, can't reach the cloud KB (#3134).
- Trail as a source for `recommendModel()` — that function reads JSON only.

## Architecture
- **KB**: "Model Selection" in the broberg-ai tenant (Trail provisions; gives KB-id + base URL).
- **Write**: `wiki-write` REST from this session (and optionally a monthly-run step when a new lesson is detected). Paths `/neurons/concepts/` (philosophy) + `/neurons/heuristics/` (rules-of-thumb).
- **Query**: the `model-advisor` skill calls `/chat` for the qualitative layer, then combines with the JSON numbers.
- **Boundary**: numbers → JSON (authoritative); narrative → Trail (advisory). The advisor never lets a Trail sentence override a JSON price.

## Seed lessons (initial KB content)
- `/neurons/heuristics/`: medium-3.5 is a premium coding tier ($1.5/$7.5) — default to Large 3 ($0.5/$1.5) instead.
- `/neurons/heuristics/`: OpenRouter slugs use dots (`claude-haiku-4.5`); dashed forms silently mismatch → $0 cost (F014 finding).
- `/neurons/concepts/`: GDPR is a hard gate for personal/client data → EU-hosted (Mistral) only ([[mistral-is-gdpr-provider]]).
- `/neurons/concepts/`: Mistral OCR is per-page, EU-hosted — right for patient documents; Voxtral = the GDPR-safe audio path.
- `/neurons/concepts/`: F010 ground-truth cost overrides the table for OpenRouter routes.

## Stories
- **F018.1** — Trail cloud REST client (`wiki-write` + `chat`, `TRAIL_API_KEY` in `.env`, `X-Trail-Tenant: broberg-ai`); verify read/write against the provisioned "Model Selection" KB.
- **F018.2** — Seed the KB with the lessons above (correct `/neurons/concepts/` vs `/neurons/heuristics/` paths).
- **F018.3** — `model-advisor` skill consults the KB (`/chat`) for the "why" layer, combined with JSON numbers; numbers always authoritative.
- **F018.4** — Capture-new-lessons habit: documented step (manual + optional monthly-run hook) to `wiki-write` a new lesson when one surfaces.

## Acceptance criteria
1. The Trail REST client can `wiki-write` + `/chat` the "Model Selection" KB (live-verified with the scoped `TRAIL_API_KEY`).
2. The KB is seeded; a `/chat` query for "mistral medium 3.5" returns the premium-tier lesson.
3. The `model-advisor` skill cites a relevant Trail lesson alongside the JSON numbers when one exists — numbers always from JSON, never Trail.
4. The JSON inventory + `recommendModel()` are unchanged and still authoritative.

## Dependencies
- **F017** (JSON inventory + advisor skill) — F018 layers narrative on top.
- **Trail** — provisions the "Model Selection" KB + delivers `TRAIL_API_KEY` via daemon-.env-write (#3157). REST mechanics per #3134; MCP/table-mirror dropped.

## Rollout
Additive + low-risk — the JSON path is untouched. Phase: REST client → seed KB → skill consults it → capture-habit. Rollback = stop writing / drop the key; nothing else depends on it.

## Effort estimate
**S** — ~1 day once the KB + key land (a thin REST client + seeding + a skill tweak). Smaller than the table-mirror idea because we're not fighting RAG over deterministic data.
