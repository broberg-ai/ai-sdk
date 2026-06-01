# F1 — Repo-wide AI usage inventory (cc traversal)

## Role
Audit every local repo to discover all current AI/LLM/GenAI usage before designing the public SDK surface.

## Task
Run a cc traversal across all known repos, produce `AI-INVENTORY.md`, and lock the real capability + provider matrix against actual usage — not guesses.

## Context
An earlier attempt to wrap the Vercel AI SDK failed because repos kept speaking the underlying SDK dialect directly. The inventory must drive the spec so abstraction layers are derived from real, observed usage patterns.

**Known repos to scan:**
- `cms` — @webhouse/cms (AI-native CMS)
- `trail` — knowledge-base / neurons system
- `buddy` — adversarial code reviewer
- `sanneandersen` — new fal.ai image generation usage
- `xrt81` — new AI usage (unknown capabilities yet)
- `@webhouse/ai` — thin config-wrapper to absorb

## Non-goals
- This epic produces a document, not code
- No migration happens in F1; sequence is informed by the inventory
- No architecture decisions; document what exists

## Deliverable
`AI-INVENTORY.md` at the repo root with:
1. Summary table (repo, call-sites count, providers, capabilities, tracks-cost, transports)
2. Per-repo detail sections grouping every call-site by capability
3. Unmapped section for usage fitting no known capability (candidate new abstractions)
4. Migration-risk notes flagging provider-coupled hotspots

## Stories

| Story | Title |
|---|---|
| F1.1 | Write traversal script |
| F1.2 | Build AI-INVENTORY.md summary table |
| F1.3 | Per-repo detail sections |
| F1.4 | Unmapped + migration-risk sections |

## Acceptance criteria
1. cc traversal scans every git repo read-only, skipping `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `.turbo/`
2. `AI-INVENTORY.md` produced with summary table (repo, call-sites, providers, capabilities, tracks-cost, transports)
3. Per-repo detail groups every call-site by capability
4. Unmapped section lists usage that fits no known capability (candidate new abstraction layers)
5. Migration-risk notes flag provider-coupled hotspots
