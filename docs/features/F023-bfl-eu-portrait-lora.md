# F023 — Person / Portrait generation via Black Forest Labs (EU)

> A GDPR-safe, EU-resident route for generating photorealistic portraits of a *person* (consent-based dev-portraits), via Black Forest Labs pinned to its EU endpoint. Complements F021 (fal style-LoRA, US). Tier: capability + provider. Status: **SHIPPED — two EU-resident modes: F023.5 `referenceImages` (FLUX 2 multi-reference, NO training, v0.15.0, the recommended default) and F023 `finetune` (dashboard-trained subject, v0.14.0). Decided + live-verified on a real face with Christian 2026-06-16.**

## F023.5 — FLUX 2 multi-reference (no training step) — the better path

After v0.14.0 shipped, Christian surfaced BFL's `flux-2-max` with `input_image…input_image_8`: **multi-reference generation** — reference photos go straight into the generate call, **no finetune/training at all**. Live-verified end-to-end on `api.eu.bfl.ai` (and on Christian's own face through `createAI()`):

- ✅ **EU-resident whole chain:** submit `api.eu.bfl.ai/v1/flux-2-max` → poll `api.eu2.bfl.ai` → deliver `delivery.eu2.bfl.ai`. Never global/US.
- ✅ **No training step** — 1–8 reference photos in the call; likeness back in ~30–50s. `flux-2-pro`/`flex` also on EU.
- ✅ **Real cost from the API** — submit returns `cost` in credits (1 credit = $0.01, official): flux-2-max ≈ $0.25/img, flux-2-pro ≈ $0.12/img. `usage.costUsd` reads it, not an estimate.
- ✅ **Bytes path is EU-pure** — a `Uint8Array` reference is base64-inlined into the EU call (no cross-region fetch); a URL forces BFL to fetch it (Wikimedia even 403'd it). SDK supports both.

**Shape (shipped v0.15.0):** `ai.image({ referenceImages: (string|Uint8Array)[1–8], seed?, outputFormat?, safetyTolerance?, override? })`. `referenceImages` routes to `DEFAULT_BFL_REFERENCE_SPEC = {provider:"bfl", model:"flux-2-max"}`. **Default model = flux-2-max** (Christian's choice — premium quality; live test showed pro ≈ max likeness at half price, but he picked max as default). The easy cheap switch is `override:{ model:"flux-2-pro" }` (one field; provider stays bfl, still EU). Adapter `bfl.ts` branches: `referenceImages` → FLUX 2; `finetune` → finetuned-inference. Cost read from the response.

**Verified on Christian's face (2026-06-16):** 3 portraits generated through the SDK (max-corporate, max-founder, pro-corporate) — all clearly him; framing learning: a relaxed/natural portrait flatters more than a tight corporate crop. Total test spend ≈ $1.07 of his $10 BFL credits.

---


## ⚠️ Verification finding (2026-06-16) — why this is a "delt flow", not full automation

Before writing the adapter, BFL's **live** API was probed (key in `.env`, never echoed). The rigorous test — POST with a valid key, `422 = endpoint exists` vs `404 = gone`:

- ✅ **EU finetuned-INFERENCE works:** `POST /v1/flux-pro-1.1-ultra-finetuned` on `api.eu.bfl.ai` → 422 "finetune_id required" (path live, `x-key` auth confirmed). Poll `GET /v1/get_result?id=…` → `{id,status,result,progress,preview}`.
- ✅ **Finetune MANAGEMENT on EU:** `GET /v1/my_finetunes` → 200, plus `finetune_details` + `delete_finetune`.
- ❌ **NO finetune-CREATE endpoint on ANY region.** Same valid key: `POST /v1/finetune` → **404 "Not Found"** on `api.eu/us/global.bfl.ai` (vs 422 on inference paths — proof the path is genuinely gone, not a method/auth error). The legacy dedicated finetune hosts `api.eu1/us1.bfl.ai` still resolve (stale Azure IPs) but **TCP-time-out** — decommissioned.

**Implication:** BFL's current public API can *run + manage* EU-resident finetunes, but cannot **create** one programmatically. Creation moved to the web dashboard (`dashboard.bfl.ai`) / enterprise. So a fully-automated `ai.trainSubject` **cannot be built** — but the EU-resident *inference* half can, and that is what shipped. **Lesson: live-probe a provider's API with the right method before planning an adapter — the docs/blog said finetuning exists; the live API says create is gone.**

**Christian's decision (2026-06-16): delt flow.** Train the subject once in the BFL dashboard (EU, with consent); the SDK automates EU-resident generation thereafter. Self-host (full EU) and fal-DPA (US biometric) were the rejected alternatives.

## Motivation

components (Christian's wish) wants one path that turns a person's photos into **photorealistic portraits ~98% matching** (consent-based dev-portraits) — without ever sending a face to the US. F021 (`ai.trainStyle`/fal) is the wrong tool: (1) its `is_style:true` is built for an artistic *style*, not a *face*; (2) a face is **biometric personal data** (GDPR's strictest category) and fal.ai is US-hosted with no EU residency. BFL (FLUX's makers, Freiburg DE) exposes a dedicated EU endpoint `api.eu.bfl.ai`, so the biometric inference is processed in the EU.

## Solution

A new **BFL provider adapter** (`src/providers/bfl.ts`), hard-pinned to the EU endpoint, exposing BFL **finetuned-inference** through the existing `ai.image` capability via a new `finetune` param. A subject's likeness is trained **once, manually, in the BFL dashboard** (the public API has no create endpoint — see finding); the resulting `finetune_id` then flows into `ai.image({ finetune, override:{provider:"bfl"} })`, which generates EU-resident, cost-tracked like every other call. F021 (fal style-LoRA) stays unchanged for the *style* use-case.

## Governance (in scope — the frame around the whole feature)

**Consent-based, operationally-sensible use ONLY. Never a deepfake of anyone without explicit sign-off.** The broberg.ai case is always a customer who *wants* their own face auto-generated (it saves them time) and has given explicit consent. "Do good, do no evil." This is the capability's usage contract — policy, not code-enforceable — and MUST be stated wherever the capability is described (docstring, `docs/API.md`, the Discovery catalogue entry).

## Scope

### In scope (shipped)
- `src/providers/bfl.ts` — BFL adapter, **base URL hard-pinned to `https://api.eu.bfl.ai`** (never the global `api.bfl.ai`, which auto-failovers across regions and could route a face to the US). Auth header `x-key` from `BFL_API_KEY`. Finetuned-inference: `POST /v1/flux-pro-1.1-ultra-finetuned` → poll `GET /v1/get_result?id=…` until `Ready` → `result.sample` URL. Polls the **EU** get_result by id (not the returned `polling_url`) so a face-bearing response never transits a non-EU host. Per-image cost stamped in-adapter (BFL convention, like fal/gemini).
- `ai.image({ finetune, finetuneStrength?, override })` — when `finetune` is set, routes to the BFL EU adapter (alongside the existing fal `lora` path). `width`/`height` derive `aspect_ratio` (gcd-reduced). Wired in `src/client.ts`, schema in `src/schema/inputs.ts`, fields on `ImageRequest` (`src/types.ts`).
- Adapter registered in `src/providers/registry.ts`; exported from `src/index.ts`.
- Tests: `src/providers/bfl.test.ts` — incl. the **GDPR-crux assertion** (every request pinned to `api.eu.bfl.ai`, never global/US), the submit→poll→Ready flow, body shape, moderated-status + missing-key/finetune errors, and client routing.
- **Manual training SOP** (below) + `docs/API.md` rows + changelog + the governance note + Discovery ping.

### Out of scope
- **Automated `ai.trainSubject`** — BFL's public API has no finetune-create endpoint (verified). Training is the manual dashboard SOP below; if/when BFL re-exposes create, a follow-up F-number adds it.
- Changing F021 (`ai.trainStyle`/fal style-LoRA) — stays as-is.
- A portable LoRA-weight file (BFL returns a hosted `finetune_id`, not a `.safetensors`).
- Consent capture / DPA tooling — the consuming app's job.
- Real employee faces in any test/calibration — calibration runs on **public/synthetic portraits only** until the consuming app has consent in place.
- Self-hosted EU training (Scaleway/OVH) — documented fallback if BFL proves insufficient.

## Manual training SOP (the "delt" half — one-time per person, with consent)

1. **Consent first.** Only a person who has signed off on their own likeness being generated.
2. In **`dashboard.bfl.ai`** → Finetune → upload 1–20 photos (JPG/PNG/WebP, ≤1MP), `mode = character`, set a `trigger_word`, iterations ~300. **Select the EU region** if the dashboard offers a region choice (BFL's privacy policy states EU data residency + SCCs; confirm in the UI at upload time — this is the one residency point outside SDK control).
3. When training completes, copy the **`finetune_id`** (also listed via `GET /v1/my_finetunes`).
4. Generate via the SDK — fully automated, EU-resident:
   ```ts
   const { url, usage } = await ai.image({
     prompt: "<trigger_word> as a professional headshot, studio light",
     finetune: "<finetune_id>",
     finetuneStrength: 1.2,
     override: { provider: "bfl" },   // also auto-selected whenever `finetune` is set
   });
   ```

## Architecture

### `src/providers/bfl.ts` (as built)
```ts
const EU_BASE = "https://api.eu.bfl.ai"; // HARD-PINNED — never global/US (GDPR crux)
// image(req) requires req.finetune. Body: { finetune_id, prompt, finetune_strength?, aspect_ratio? }
// POST /v1/flux-pro-1.1-ultra-finetuned → { id }; poll GET /v1/get_result?id=… until "Ready"
//   → result.sample (image URL). Auth header "x-key": BFL_API_KEY. Per-image cost in-adapter.
// Moderated / Error / Task-not-found statuses throw a clear error. No finetune id → actionable throw.
```

### `ai.image({ finetune })` routing (client.ts)
`input.finetune` → `DEFAULT_BFL_FINETUNE_SPEC` (`{provider:"bfl", model:"flux-pro-1.1-ultra-finetuned", transport:"http"}`); LoRAs → fal flux-lora; else plain image. Override always wins.

## Stories
- **F023.1** — BFL EU provider adapter (`src/providers/bfl.ts`): finetuned-inference, `x-key` auth, **EU-endpoint-pinned**, submit→poll. Registered + exported. ✅ shipped
- **F023.2** — `ai.image({ finetune, finetuneStrength })` BFL inference route + `finetune` field on `ImageRequest`/`imageInputSchema`/client wiring. ✅ shipped
- **F023.3** — Tests (GDPR-crux pin, flow, errors, routing) + `docs/API.md` + changelog + governance note + manual-training SOP. ✅ shipped
- **F023.4** — Ship a minor via `publish.yml`; Discovery catalogue ping; synthetic-face fidelity calibration (public images), then Christian's own face once he trains a finetune in the dashboard. ⏳ (calibration awaits a trained `finetune_id`)

## Acceptance criteria
1. ✅ The BFL adapter pins `https://api.eu.bfl.ai` — a unit test asserts **every** request URL starts with it and never hits the global/US host. (GDPR-critical.)
2. ✅ `ai.image({ prompt, finetune:"<id>", override:{provider:"bfl"} })` posts `finetune_id` to `/v1/flux-pro-1.1-ultra-finetuned`, polls `get_result`, and returns an image URL + `usage.costUsd` — injected-fetch test, no live metered call in CI.
3. ✅ `BFL_API_KEY` read lazily from env (ship-dark: adapter instantiates without it; only a live call needs it).
4. ✅ The consent-only / no-deepfake governance note appears in the docstring + `docs/API.md` + the Discovery entry.
5. ✅ `bun test` full suite green; `tsc --noEmit` clean; published as a minor via `publish.yml`.
6. ⏳ Live fidelity calibration on **public/synthetic** portraits against `api.eu.bfl.ai` (documented result), then Christian's own face — both gated on a `finetune_id` trained in the dashboard (real employee faces excluded until consuming-app consent exists).

## Dependencies
- Reuses the `ai.image` capability shape. Independent of F021/F022. Needs `BFL_API_KEY` (Christian's test key in the gitignored `.env`) and — for calibration — a `finetune_id` trained once in `dashboard.bfl.ai`.

## Rollout
Additive minor. New provider + one `ai.image` param; no change to F021/fal paths or existing call-sites. Ship via OIDC `publish.yml`. The adapter is inert without `BFL_API_KEY` (ship-dark). Rollback = revert the minor. Notify components when shipped so Discovery catalogues "person/portrait generation (EU, finetuned)".

## Open Questions
- **Dashboard EU residency at upload time** — BFL's privacy policy claims EU data residency + SCCs and finetuning was historically EU-region-selectable, but the dashboard region choice can only be confirmed inside Christian's authenticated BFL account at training time. Flagged in the SOP; the SDK inference half is unambiguously EU-pinned regardless.
- **BFL per-image pricing** — set to a $0.06 in-adapter estimate (flux-pro-1.1-ultra-finetuned), overridable via `config.pricePerImage`; confirm against bfl.ai/pricing and tighten if needed. Never a fabricated-precise number presented as official.

## Effort estimate
**M** — ~1 day (was L). Inference-only adapter + one `ai.image` param + tests + docs; the training automation that made it L is out (BFL API can't).
