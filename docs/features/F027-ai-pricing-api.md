# F027 — AI Pricing API (model prices queryable from the npm package)

> Tier: catalogue/cost. Effort: S–M. Status: building. Consumer: Trail (edge).

## Motivation

The rich model **inventory** (prices / GDPR-region / suitability for 346 OpenRouter-reachable models) lives in `inventory.json` in this repo, but the **published npm package does not ship it** (`package.json` `files: ["dist"]`). The only price lookup that ships is `getPrice(provider, model)` over the **35 curated** entries in `src/cost/pricing.ts` — the providers we route to, not "all models". Trail runs on an **edge** (Worker/serverless), can't reach the ai-sdk session, and needs to **call up exact prices for ALL models** programmatically. It also can't `fs`-load a JSON file (edge bundling), so the data must be **bundled + browser-clean** — exactly the constraint the `@broberg/ai-sdk/registry` subpath already solves (F022.5).

## Solution

Add a **browser-clean `@broberg/ai-sdk/pricing` subpath** that bundles a *trimmed* pricing projection of `inventory.json` (all 346 models, price-relevant fields only → edge-light) plus lookup functions. The 35 curated prices (`src/cost/pricing.ts`, the authoritative routed-provider numbers) overlay the inventory prices at runtime. No `fs`, no `bun:sqlite` — bundles in a Vite/Worker build.

## Scope

### In scope
- `scripts/gen-pricing.mjs` — reads `inventory.json` → emits `src/catalogue/pricing-data.ts` (gitignored, like `version.ts`): `export const PRICING_DATA: ModelPriceRaw[]` with `{ provider, model, name, input, output, unit, region }` only (drops description/modalities → ~5× smaller). Wired into `build` (`gen-version && gen-pricing && tsup`).
- `src/catalogue/pricing-api.ts` — the API over `PRICING_DATA` + curated `PRICING` overlay:
  - `getModelPrice(modelId): ModelPrice | undefined` — `modelId` accepts `"provider/model"`, `"provider:model"`, or a bare `model`; returns `{ provider, model, name?, inputPer1M, outputPer1M, unit, region, source: "curated" | "inventory" }`.
  - `listModelPrices(): ModelPrice[]` — all models (curated overlaid).
  - `findModelPrices(filter?): ModelPrice[]` — by `{ provider?, region?, maxInputPer1M?, free? }`.
  - `priceCall(modelId, inputTokens, outputTokens): number | undefined` — convenience USD compute.
- `src/pricing.ts` — the subpath barrel (re-exports pricing-api), mirroring `src/registry.ts`.
- `package.json` — add `"./pricing"` to `exports` (types + import) and `"gen-pricing"` script; keep `files: ["dist"]` (data is bundled into dist, not shipped raw).
- `tsup.config.ts` — add `pricing: "src/pricing.ts"` entry.
- `src/catalogue/pricing-api.test.ts` — coverage: id-normalisation (`/` vs `:`), curated overlay wins over inventory, all-models count, region filter, browser-clean (no `bun:sqlite`/`fs` in the `pricing` entry).
- `docs/API.md` — a `### Pricing API` section.

### Out of scope
- **A hosted HTTP pricing service.** The card asks to expose prices *via the npm package* ("opdater din npm"), not to stand up a server. (A hosted endpoint can be a later F-number if a non-JS consumer needs it.)
- **Changing `getPrice`/`computeCost`** in `src/cost/pricing.ts` — they stay (cost-tracking hot path); the new API reuses the curated table as the authoritative overlay.
- **Shipping raw `inventory.json`** in `files` — the bundled+trimmed projection is what ships; raw inventory stays a repo/build artifact.
- **Live price fetching** — prices are as-of `inventory.json`'s `generatedAt` (monthly F014/F017.5 refresh); the API exposes that timestamp so a consumer can flag staleness.

## Architecture

### `pricing-api.ts`
```ts
export type PricingUnit = "per_1m_tokens" | "per_image" | "per_minute" | "per_second" | "flat";
export interface ModelPrice {
  provider: string; model: string; name?: string;
  inputPer1M: number; outputPer1M: number; unit: PricingUnit;
  region: "eu" | "us" | "cn" | "other"; source: "curated" | "inventory";
}
export function getModelPrice(modelId: string): ModelPrice | undefined;
export function listModelPrices(): ModelPrice[];
export function findModelPrices(filter?: { provider?: string; region?: string; maxInputPer1M?: number; free?: boolean }): ModelPrice[];
export function priceCall(modelId: string, inputTokens: number, outputTokens: number): number | undefined;
export function pricingGeneratedAt(): string; // inventory.json generatedAt — for staleness
```
- **Overlay:** build a `Map<normId, ModelPrice>` from `PRICING_DATA` (source:"inventory"), then overwrite entries present in the curated `PRICING` table (source:"curated", authoritative routed-provider numbers). `normId` strips the `provider:`/`provider/` prefix variance.
- **Browser-clean:** imports only `PRICING_DATA` (pure data) + the curated `PRICING` record + types — no `fs`, no `bun:sqlite`.

## Stories
- **F027.1** — `gen-pricing.mjs` + `pricing-data.ts` + `pricing-api.ts` + `src/pricing.ts` subpath; package.json/tsup wiring; tests.
- **F027.2** — `docs/API.md` `### Pricing API` section; release `0.19.0` + ping Trail/cardmem/components with the version + the `@broberg/ai-sdk/pricing` import.

## Acceptance criteria
1. `import { getModelPrice } from "@broberg/ai-sdk/pricing"` returns a typed `ModelPrice` for a model from the 346-strong inventory (e.g. a DeepSeek model), AND a curated model (e.g. `anthropic:claude-sonnet-4-6`) returns `source:"curated"` with the authoritative number — both covered by tests.
2. `listModelPrices().length` ≈ inventory model count (≥ 300), deduped with curated overlay; `findModelPrices({ region:"eu" })` returns only EU models.
3. Id-normalisation: `getModelPrice("deepseek/deepseek-v4-flash")` === `getModelPrice("deepseek:deepseek-v4-flash")`.
4. The `pricing` build entry imports no `bun:sqlite`/`fs` (asserted) → bundles in a browser/edge build.
5. Full `bun test` green; `0.19.0` published via `publish.yml`; `npm view @broberg/ai-sdk@0.19.0` resolves; Trail pinged with the import + `pricingGeneratedAt()` staleness note.

## Dependencies
- `inventory.json` (F014/F017 monthly refresh) — the data source. Curated `PRICING` table (F-cost). None blocking.

## Rollout
Additive — new subpath, no change to existing exports or `getPrice`. Consumers opt in via `@broberg/ai-sdk/pricing`. Rollback = drop the export. Data freshness rides `inventory.json`'s monthly regen; `pricingGeneratedAt()` lets consumers detect staleness.

## Open Questions
None blocking. (If a non-JS consumer later needs prices over HTTP, that's a separate hosted-API F-number.)

## Effort estimate
**S–M** — ~half a day: the gen step + API + tests are the bulk; the subpath wiring mirrors `registry`.
