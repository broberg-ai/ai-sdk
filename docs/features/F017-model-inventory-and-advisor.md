# F017 — Model Inventory + Advisor

> A real LLM **inventory** (prices WITH units + modality + capabilities/strengths + GDPR-region + license, kept fresh monthly) and a **Model Advisor** (a local repo skill + a deterministic function) that recommends the right provider/model for a described task — so Christian (and other repos via intercom) can rely on getting the right answer instead of guessing. Tier: capabilities/tooling. Effort: L–XL. Status: planned.

## Motivation

F014 gave us a price/availability **catalogue** — but Christian's right that it's not a real inventory: it has prices but not *what each model is good for*, its modality, its GDPR posture, or its licence. That missing dimension is exactly what's needed to answer the recurring question: **"I need to do X — which model should I use?"**

Two consumers need a trustworthy answer:
1. **Christian, conversationally** — "jeg skal lave det og det" → I run a skill that reasons over the inventory and recommends primary + fallback with rationale (price, region, why), not from memory.
2. **Other repos, via intercom** — a session sends `ask_peer({to:"ai-sdk", "which model for <task>?"})` and must be able to *rely* on the answer.

The OpenRouter models directory (Christian's 92-page export) shows the raw material already exists: every model carries modality (Text/Image/Audio/Video/Embeddings/Rerank/Speech), **category rankings** ("#26 in Finance", "#28 in Health"), a description, priced in proper units (per-token / per-char / per-minute / per-image), context length, and GDPR-relevant flags (In-Region Routing, Zero Data Retention). Most of an inventory is auto-populatable from the OpenRouter API; the rest ("good for what", GDPR-safe truth) is a small curated overlay. The monthly run keeps it all fresh across **every** provider (anthropic, openai, google, mistral, meta, deepseek, qwen, xAI, nvidia, microsoft, minimax, cohere, …) that OpenRouter exposes.

## Solution

Extend the F014 catalogue into a rich `InventoryModel`, populated by merging (a) OpenRouter API auto-enrichment with (b) a hand-curated overlay, persisted as a versioned `inventory.json` in the repo. Build a `recommendModel()` advisor that filters the inventory by hard constraints (GDPR, modality, capability, budget) and ranks by fit, returning cited recommendations. Expose it two ways: a `.claude/skills/model-advisor.md` skill (conversational + intercom) and the underlying function (deterministic, testable). The monthly run (F014.4) re-enriches the inventory and opens the PR.

## Scope

### In scope
- `src/catalogue/inventory.ts` — `InventoryModel` schema + merge logic (OpenRouter auto-enrich ⊕ curated overlay) → `inventory.json`.
- Extend `fetchOpenRouterCatalogue` (`src/catalogue/fetchers.ts`) to capture the fields it currently drops: input/output modalities, description, category rankings, pricing **unit**, supported parameters, in-region-routing / zero-data-retention flags.
- `src/catalogue/curated.ts` — hand-maintained overlay: `goodFor` capability tags, per-provider GDPR/region truth, recommended-use notes, for the models we actually use.
- `src/catalogue/advisor.ts` — `recommendModel({task, constraints}) → {primary, fallback, alternatives, rationale}`; deterministic, cites inventory data + flags inventory staleness.
- `.claude/skills/model-advisor.md` — the conversational skill + the documented intercom protocol (a CLAUDE.md note so other sessions know they can ask).
- Extend the monthly run (F014.4 GitHub Actions) to re-enrich + diff the inventory and include it in the PR; new models land with curated fields flagged TODO.

### Out of scope
- Live model-quality benchmarking (running eval suites ourselves). We use OpenRouter's category rankings + published benchmarks + curated notes, not our own evals.
- Auto-routing at call time (the SDK picking a model per request automatically). The advisor *recommends*; the caller still passes an explicit `override`/tier. (A future `tier:"advisor"` auto-route could build on this, but not here.)
- A hosted web UI for the inventory. It's a JSON file + a skill + a function.
- Replacing F014's price-diff — F017 builds on it; the monthly run does both.

## Architecture

### `InventoryModel` — `src/catalogue/inventory.ts`
```ts
interface InventoryModel {
  provider: string; model: string;
  pricing: { input?: number; output?: number; unit:
    "per_1m_tokens" | "per_1k_chars" | "per_minute" | "per_hour" | "per_image" | "per_page";
    cacheReadPer1M?: number; cacheWritePer1M?: number };
  inputModalities: string[];   // text | image | audio | video | file
  outputModalities: string[];  // text | image | audio
  contextLength?: number;
  categories: { name: string; rank?: number }[]; // OpenRouter rankings (Finance #26 …)
  goodFor: string[];           // curated: reasoning|coding|vision|ocr|tts|transcription|moderation|embedding|agentic|multilingual|creative|edge
  description?: string;
  region?: "eu" | "us" | "cn" | "other";
  gdprSafe?: boolean;          // EU-hosted + DPA, no Schrems II (curated per provider)
  inRegionRouting?: boolean; zeroDataRetention?: boolean;
  license?: string;            // apache-2.0 | modified-mit | proprietary | …
  source: "openrouter" | "curated" | "direct";
  updatedAt: string;
}
```
Persisted as `inventory.json` (committed, versioned). `updatedAt` + a top-level `generatedAt` let the advisor flag staleness.

### Advisor — `src/catalogue/advisor.ts`
```ts
interface AdvisorConstraints {
  gdprRequired?: boolean;      // → only gdprSafe models
  modality?: string;           // required input modality (e.g. "audio", "image")
  capability?: string;         // required goodFor tag (e.g. "ocr", "reasoning")
  maxInputPer1M?: number; maxOutputPer1M?: number;
  needsAudit?: boolean;        // → reasoning models w/ transparent trace
  latency?: "low" | "any";
}
recommendModel(task: string, c: AdvisorConstraints): {
  primary: InventoryModel; fallback?: InventoryModel; alternatives: InventoryModel[];
  rationale: string;           // cites price, region, category rank, why
  inventoryAge: string;        // "fresh (3d)" | "STALE (42d) — run the monthly enrichment"
}
```
Hard-filters on gdpr/modality/capability/budget, then ranks by category-rank + price + capability fit. Rationale quotes real numbers so the answer is auditable — the "rely on it" requirement.

### Skill + intercom — `.claude/skills/model-advisor.md`
The conversational entry point: Christian says "jeg skal lave X" → invoke the skill → it reads `inventory.json`, runs the advisor logic, answers with primary/fallback/rationale (in product language), and flags if the inventory is stale. Same path answers an intercom `ask_peer({to:"ai-sdk", "which model for X?"})`. A CLAUDE.md note documents the protocol so other sessions know ai-sdk is the model-advisor authority.

### Monthly enrichment — extends F014.4
The monthly GitHub Actions run re-fetches every provider via OpenRouter, refreshes the auto-enriched fields, detects new models (added to `inventory.json` with `goodFor`/`gdprSafe` flagged `TODO-curate`) and new providers, diffs prices, and opens one PR. Keeps the inventory trustworthy without manual sweeps.

## Stories
- **F017.1** — `InventoryModel` schema + extend the OpenRouter fetcher to capture modality / description / category-rankings / pricing-unit / region flags; build `inventory.json` from the auto-enrichable fields.
- **F017.2** — Curated overlay (`src/catalogue/curated.ts`): `goodFor` tags + per-provider GDPR/region truth + recommended-use, merged over the auto-enriched data for the models we use across products.
- **F017.3** — `recommendModel()` advisor (`src/catalogue/advisor.ts`): constraint filter + fit ranking + cited rationale + staleness flag; unit-tested against a fixture inventory.
- **F017.4** — `.claude/skills/model-advisor.md` skill + intercom protocol (CLAUDE.md doc) so Christian and other repos get reliable, inventory-backed recommendations.
- **F017.5** — Extend the monthly run (F014.4) to re-enrich + diff the inventory and open the PR (new models flagged for curation, new providers surfaced).

## Acceptance criteria
1. `inventory.json` exists and, for every OpenRouter-listed model, carries pricing-with-unit + input/output modalities + context + description + any category rankings (auto-enriched, live-verified against the real API).
2. The curated overlay correctly tags GDPR-safety per provider (e.g. mistral → `gdprSafe:true, region:eu`; anthropic/openai/gemini direct → `gdprSafe:false, region:us`) and `goodFor` for the models we use.
3. `recommendModel("transcribe Danish voice notes, GDPR-required", {gdprRequired:true, modality:"audio"})` returns a GDPR-safe audio model (e.g. Voxtral) with a rationale citing region + price; a non-GDPR query may return a cheaper US model. Verified by tests over a fixture inventory.
4. The `model-advisor` skill answers a free-text task with primary + fallback + rationale, in product language, and flags inventory staleness when `generatedAt` is old.
5. The monthly run updates `inventory.json` (prices + new models flagged for curation) and opens a PR; a manual `workflow_dispatch` proves it (runtime-verified, not just committed).
6. typecheck clean + full suite green; advisor answer is reproducible (deterministic given the same inventory).

## Dependencies
- **F014** (catalogue fetchers + diff + monthly GitHub Actions run) — F017.1 extends `fetchOpenRouterCatalogue`; F017.5 extends the F014.4 workflow.
- **[[mistral-is-gdpr-provider]]** — the GDPR-region curated truth starts from this standing decision (Mistral = EU/safe).
- F015/F016 capabilities inform `goodFor` tags (which models do OCR / TTS / moderation / reasoning).

## Rollout
Phased, each story shippable:
1. F017.1 + F017.2 build the inventory (auto + curated) — pure data + library, no behaviour change.
2. F017.3 + F017.4 add the advisor function + skill — the conversational/intercom value lands.
3. F017.5 wires the monthly enrichment so it stays fresh.
The inventory is a committed JSON artifact; the advisor reads it. No runtime/prod surface, so rollback = revert the file/skill. The advisor never makes calls — it only recommends — so there's no cost/blast-radius risk.

## Open Questions
- **Category rankings via API?** OpenRouter's web UI shows per-category rankings (#26 Finance …). Confirm whether `/api/v1/models` exposes them or if a second endpoint / curation is needed. If unavailable via API, `goodFor` leans more on curation + descriptions.
- **Curation maintenance** — how much `goodFor` to curate up front vs. let the monthly run flag new models for incremental curation? Plan assumes: curate the ~30 models we actually use now; flag the rest TODO.
- **GDPR truth granularity** — per-provider (simple, mostly right) vs per-model/per-region-routing (precise, more upkeep)? Plan starts per-provider + uses OpenRouter's in-region-routing/zero-data-retention flags where present.
- Should there eventually be a `tier:"advisor"` that auto-routes a call to the recommended model? Out of scope now; F017 makes it possible later.

## Effort estimate
**L–XL** — ~4–6 days. F017.1 (~1.5d, fetcher enrichment + schema + persistence), F017.2 (~1d curation), F017.3 (~1d advisor + tests), F017.4 (~0.5d skill + protocol), F017.5 (~0.5d monthly-run extension).
