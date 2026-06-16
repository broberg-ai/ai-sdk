# F023 — Person / Portrait LoRA via Black Forest Labs (EU)

> A GDPR-safe, EU-resident route for finetuning FLUX on a *person's* likeness (consent-based dev-portraits), via Black Forest Labs' FLUX Pro Finetuning API pinned to its EU endpoint. Complements F021 (fal style-LoRA, US). Tier: capability + provider. Effort: L (~2 days). Status: **BLOCKED — see verification finding below.**

## ⚠️ Verification finding (2026-06-16) — BLOCKS the training half

Before writing the adapter, the live BFL API was probed (key in `.env`). Exhaustive result (all 24 paths on **api.eu.bfl.ai**, identical on global + us):

- ✅ **EU finetuned-INFERENCE works:** `POST /v1/flux-pro-1.1-ultra-finetuned` + `/v1/flux-pro-1.0-fill-finetuned` exist on `api.eu.bfl.ai` (auth `x-key` confirmed; poll shape `{id,status,result,progress,preview}` via `GET /v1/get_result`).
- ✅ **Finetune MANAGEMENT on EU:** `GET /v1/my_finetunes`, `GET /v1/finetune_details`, `POST /v1/delete_finetune`.
- ❌ **NO finetune-CREATE endpoint on ANY region.** `/v1/finetune` (the create/train step the F021 blog announced on the now-dead `api.us1.bfl.ai`) is **absent from the public OpenAPI on eu, us, AND global** (`api.{eu,us,}.bfl.ai` all 404 it; no create/train/submit path of any name in the 24-path spec). The `eu1`/`us1` hosts no longer resolve.

**Implication:** BFL's *current public API* can run + manage EU-resident finetunes, but cannot **create** one programmatically. The finetunes that `my_finetunes` lists must be created via another channel (almost certainly the web dashboard `dashboard.bfl.ai`, or an enterprise path). So the planned fully-automated `ai.trainSubject` → `/v1/finetune` **cannot be built as specified** — the create endpoint does not exist.

**Reframed options (Christian to decide — see intercom):**
1. **Split flow:** finetune CREATED manually via `dashboard.bfl.ai` (one-time per person, with consent) → ai-sdk automates the **EU-resident inference** half (`ai.image({ finetune, override:{provider:"bfl"} })`). EU-clean *if* the dashboard upload is EU (to verify). Training not API-automated.
2. **Self-host full EU** (Scaleway/OVH + ai-toolkit) — train + infer both self-hosted in EU; max automation + residency, biggest build. Note: a self-host LoRA cannot plug into BFL inference; self-host owns both halves.
3. **fal-DPA** for create (US biometric) — previously rejected on GDPR.

Until decided, F023 is **blocked**; only the inference-half (option 1) is buildable today.

## Motivation

components (Christian's wish) wants ÉT endpoint that, from a set of a person's photos, trains a likeness model → then auto-generates **photorealistic portraits ~98% matching** (consent-based dev-portraits). F021 already wraps fal LoRA training — but two hard blockers make F021 the wrong tool here:

1. **Style ≠ person.** F021's `ai.trainStyle` defaults to `fal-ai/flux-lora-fast-training` with `is_style:true` — built + proven for an artistic *style* (Sanne's pencil line). For a *face/subject* that config wrecks likeness; you need subject/character mode + captioning.
2. **GDPR — biometric data.** A person's face is **biometric personal data** (GDPR's strictest category). fal.ai is **US-hosted with no EU residency** — training employee faces there = personal-data → US transfer + a third-party AI on biometrics. Our standing Mistral-EU rule covers *text*; faces are a stronger reason for EU residency.

Christian chose the **EU-resident route**: Black Forest Labs (FLUX's own makers, Freiburg DE). Capability + residency are **confirmed** (see Architecture): BFL's finetuning supports a `character` (person) mode, and BFL exposes a **dedicated EU endpoint `api.eu.bfl.ai`** for GDPR. This F-number builds that route as a first-class ai-sdk capability so any fleet app gets consent-based person-LoRA without re-rolling provider plumbing — and without ever sending a face to the US.

## Solution

A new **BFL provider adapter** (`src/providers/bfl.ts`), hard-pinned to the EU endpoint, plus a first-class **`ai.trainSubject`** capability (person/character finetune → `finetuneId`) and a BFL **finetuned-inference** path on `ai.image` (`finetune` param). One EU-resident train→infer pipeline, cost-tracked like every other call. F021 (fal style-LoRA) stays unchanged for the *style* use-case.

## Governance (in scope — the frame around the whole feature)

**Consent-based, operationally-sensible use ONLY. Never a deepfake of anyone without explicit sign-off.** The broberg.ai case is always a customer who *wants* their own face auto-generated in a photorealistic style (it's in their interest — saves them time) and has given explicit consent. "Do good, do no evil." This is documented as the capability's usage contract (a doc/README note + a one-line guard in the plan-doc and capability docstring) — it is policy, not code-enforceable, but it MUST be stated wherever the capability is described (incl. the Discovery catalogue entry).

## Scope

### In scope
- `src/providers/bfl.ts` — BFL adapter, **base URL hard-pinned to `https://api.eu.bfl.ai`** (never the global `api.bfl.ai`, which auto-failovers across regions and could route a face to the US). Auth header `x-key` from `BFL_API_KEY`. Methods: finetune-create (`POST /v1/finetune`), status-poll (`GET /v1/get_result`/`finetune_details`), finetuned-inference (`POST /v1/flux-pro-1.1-ultra-finetuned` or `/v1/flux-pro-finetuned`). In-memory image ZIP reuse from F021's `node:zlib` util (BFL accepts base64 ZIP in `file_data`).
- `ai.trainSubject(input)` capability + `trainSubjectInputSchema` + `TrainSubjectRequest`/`TrainSubjectResult` types → `{ finetuneId, usage }`. Params: `images` (URLs/array → zipped), `mode` (`character`|`product`|`style`|`general`, default `character`), `triggerWord`, `iterations` (BFL min 100 / default 300), `captioning?`, `finetuneStrength?`.
- `ai.image({ finetune, finetuneStrength?, override })` — BFL finetuned-inference path (alongside the existing fal `lora`). Routes to the BFL EU adapter.
- Pricing: `bfl:` entries in `src/cost/pricing.ts` (finetune one-time + per-image) — **verified against BFL's official pricing before ship, never guessed**; `usage.costUsd` stamped.
- Tests: `src/providers/bfl.test.ts` (incl. an EU-endpoint-pinned assertion + injected-fetch finetune/infer flow), `src/capabilities/trainSubject.test.ts`.
- `docs/API.md` rows + changelog; the governance note; capability catalogue ping to components/Discovery.

### Out of scope
- Changing F021 (`ai.trainStyle`/fal style-LoRA) — stays as-is for the style use-case.
- A LoRA-weight *file* export (BFL returns a hosted `finetune_id` referenced on BFL inference, not a portable `.safetensors` like fal — different mechanic; not unified here).
- Consent capture / DPA tooling — that's the consuming app's job; F023 ships the capability + the documented usage contract, not a consent UI.
- Real employee faces in any test/calibration — fidelity calibration runs on **public/synthetic portraits only** until the consuming app has consent in place.
- Self-hosted EU training (Scaleway/OVH) — BFL-EU is the chosen route; self-host stays a documented fallback if BFL proves insufficient.

## Architecture

### Capability-confirmed findings (researched, not assumed — 2026-06-16)
- **Person training:** BFL FLUX Pro Finetuning trains on **1–20 user images** (JPG/PNG/WebP, ≤1MP) with a training-`mode` of **character | product | style | general** — `character` = person/likeness. Iterations min 100, default 300; learning-rate adjustable. (bfl.ai/blog/25-01-16-finetuning; the-decoder.com.)
- **EU residency:** BFL exposes three endpoints — global `api.bfl.ai` (auto-failover), `api.us.bfl.ai`, and **`api.eu.bfl.ai` (dedicated GDPR/EU)**. (docs.bfl.ml/api_integration.) The adapter pins `api.eu.bfl.ai` → biometric face data is processed in the EU.

### `src/providers/bfl.ts`
```ts
const BFL_EU_BASE = "https://api.eu.bfl.ai"; // HARD-PINNED — never global/US (GDPR)
// trainSubject → POST /v1/finetune { file_data: <base64 zip>, mode, trigger_word, iterations, ... }
//   → { finetune_id }; poll GET /v1/get_result?id=… until READY.
// image (finetuned) → POST /v1/flux-pro-1.1-ultra-finetuned { finetune_id, finetune_strength, prompt, ... }
//   → polling id; GET /v1/get_result → image URL. Auth: header "x-key": BFL_API_KEY.
```

### `ai.trainSubject` (client.ts + schema)
`{ finetuneId, configUrl?, usage }`. Default route `{ provider:"bfl", model:"flux-pro-finetune", transport:"http" }` (override-able). Cost = BFL finetune price (verified) in `usage.costUsd`.

### `ai.image({ finetune })`
When `finetune` is set → BFL EU finetuned-inference route; `finetuneStrength` (default ~1.1) controls likeness. Existing `lora` (fal) path untouched.

## Stories
- **F023.1** — BFL EU provider adapter (`src/providers/bfl.ts`): finetune-create + status-poll + finetuned-inference, `x-key` auth, **EU-endpoint-pinned**, ZIP reuse. Registered in `src/providers/registry.ts`.
- **F023.2** — `ai.trainSubject` capability + schema + types (character/subject finetune → `finetuneId`); governance docstring.
- **F023.3** — `ai.image({ finetune, finetuneStrength })` BFL inference path + `bfl:` pricing (finetune + per-image, **verified**).
- **F023.4** — Governance/usage-contract doc + `docs/API.md` + changelog; ship a minor; catalogue ping to components/Discovery; synthetic-face fidelity calibration (public images, not real employees).

## Acceptance criteria
1. The BFL adapter's base URL is `https://api.eu.bfl.ai` — asserted by a unit test (`expect(...).toContain("api.eu.bfl.ai")`) and never the global/US host. (GDPR-critical.)
2. `ai.trainSubject({ images:[…], mode:"character", triggerWord:"…" })` posts a base64 ZIP + `mode:"character"` to `/v1/finetune` and returns `{ finetuneId, usage }` — verified with an injected-fetch test (no live metered call in CI).
3. `ai.image({ prompt, finetune:"<id>", override:{provider:"bfl"} })` calls the BFL finetuned-inference endpoint with the `finetune_id` and returns an image URL + `usage.costUsd` from the verified `bfl:` pricing.
4. `BFL_API_KEY` is read lazily from env (ship-dark: adapter instantiates without the key; only a live call needs it) — consistent with the SDK's lazy-key convention.
5. The consent-only / no-deepfake governance note appears in the capability docstring, `docs/API.md`, and the Discovery catalogue entry.
6. `bun test` full suite green; `tsc --noEmit` clean; published as a minor via `publish.yml`.
7. Live fidelity calibration on **public/synthetic** portraits demonstrates the train→infer pipeline end-to-end against `api.eu.bfl.ai` (documented result; real employee faces excluded until consuming-app consent exists).

## Dependencies
- Reuses F021's in-memory ZIP util + the `ai.image` capability shape. Independent of F022. Needs `BFL_API_KEY` (Christian's test key already in the gitignored `.env`). BFL account = Christian's one SaaS-signup (done).

## Rollout
Additive minor. New provider + capability; no change to F021/fal paths or existing call-sites. Ship via OIDC `publish.yml`. BFL pricing verified before the cost table lands. Rollback = revert the minor; the adapter is inert without `BFL_API_KEY`. Notify components when shipped so Discovery catalogues "person/portrait LoRA (EU)".

## Open Questions
- **Exact BFL finetuned-inference endpoint** (`/v1/flux-pro-1.1-ultra-finetuned` vs `/v1/flux-pro-finetuned`) + exact param names (`finetune_strength`, `trigger_word`, `captioning`) — confirm against docs.bfl.ml / a live probe during F023.1 (key is available).
- **BFL pricing** (finetune one-time + per-MP inference) — fetch from BFL's official pricing before setting `bfl:` cost entries. Until then, `usage.costUsd` falls back to 0 with a logged note (never a fabricated number).
- **`trainSubject` vs extending `trainStyle`** — decided: a **separate** `ai.trainSubject` (different provider + return shape `finetuneId` vs `loraUrl`) keeps both clean; do not overload `trainStyle`.

## Effort estimate
**L** — ~2 days. New provider adapter (train + poll + infer), 2 capability surfaces, verified pricing, EU-pin + governance, injected-fetch tests + one live synthetic calibration.
