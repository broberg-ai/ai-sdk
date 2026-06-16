# F024 — Image-to-Video generation (`ai.animate`)

> Turn a still image (e.g. a generated portrait) into a short video via a pluggable provider, mirroring the `ai.image` pattern. Tier: capability + provider(s). Effort: M. Status: **PLAN — policy decided 2026-06-16: EU-preferred, else US/CN; customer sign-off is the GDPR basis; other figures are fictional. fal.ai is the practical default today (no verified EU image→video route yet). BFL does NOT do video (verified).**

## ✅ Policy (2026-06-16, Christian) — EU-first, else US/CN, gated by customer consent

*"Kan vi skaffe EU så kører vi EU, kan vi ikke så kører vi US eller CN — det handler mere om at min kunde signer-off på GDPR-delen, og at andre figurer der medtages i video (med mindre andet er beskrevet) er fiktive personer."*

Three rules that shape the whole feature:
1. **EU-preferred, US/CN-fallback.** Prefer an EU-resident provider **when one exists**; otherwise US or CN is acceptable. Today there is **no verified managed EU image→video** route, so **fal.ai (US) is the practical default**; if/when an EU route is verified (Vertex-Veo-EU or self-host), it becomes the preferred head of the chain. This maps cleanly onto the SDK's existing **`fallback` chain** — `ai.animate({ image, fallback:[euRoute, falRoute] })` degrades EU→US automatically.
2. **Customer sign-off = the GDPR basis.** The data subject's explicit consent legalises the non-EU transfer of their own likeness. The consuming app **owns capturing + storing that consent** (SDK can't enforce it; stated as the usage contract). So the F023-strict "EU-pin or nothing" does **not** bind here — consent replaces residency.
3. **Other figures are fictional.** Any additional people in the generated video are **fictional persons unless explicitly described otherwise** → no *third-party* biometric data, so the only real likeness is the consenting customer's. Clean "do good, do no evil."

Net effect: US/CN models are fine under this policy, and the EU route drops from a *blocker* to a *future-preferred upgrade*. The GDPR analysis below stays as the record of *why this is a deliberate, consent-grounded choice* — not an oversight.

## ✅✅ SHIPPED v0.17.0 — default pivoted to Veo DIRECT via Gemini (Christian's steer)

Christian: *"den bedste model er det ikke Veo fra Deepmind?"* — sharp catch. **fal.ai is an aggregator, not a model**; via fal you already *get* Veo. But going **direct** to Veo is cleaner for the Veo choice: live-verified that Veo is reachable on the **Gemini API with our existing `GEMINI_API_KEY`** (6 models incl. `veo-3.1-generate-preview`, all `predictLongRunning`). So the **default route is now Veo 3.1 DIRECT via the gemini adapter** — no aggregator markup, our existing key, and the natural path to EU residency (Vertex) later. **fal stays the pluggable aggregator alternative** (Kling/Seedance/fal-Veo) via `override:{ provider:"fal", … }`. Both routes built.

**Live-verified end-to-end** (a real $3.20 8s/1080p clip: portrait → video through `createAI()`). The smoke caught **two fields Google's own docs got wrong**, both *before* any spend: the image is `bytesBase64Encoded` (not `inlineData`), and `durationSeconds` is a **number** (not the string the docs show). Veo result URIs are auth-gated, so the adapter downloads the bytes and returns them in `AnimateResult.bytes` (+ `mimeType`) alongside `url`. Real per-second cost stamped (Veo 3.1 Standard $0.40/s — official). `ai.video` was taken (F019 understanding) → generation is `ai.animate`.

## ⚠️ Lead finding — the GDPR lens the capability landscape misses

The June-2026 image-to-video landscape (Veo, Grok Imagine, Seedance, Kling, Hailuo, LTX, Luma, Pixverse, Runway; aggregators fal.ai / WaveSpeed / Atlas) is strong on **capability + price** but silent on the one thing that drove our whole BFL portrait work: **a video of a real person's face is biometric personal data (GDPR strictest).** Most providers are **US** (Veo/Google, Grok/xAI, Runway, Luma, Pika) or **CN** (Kling, Seedance/ByteDance, Hailuo/MiniMax). fal.ai — the convenient aggregator already in our stack — is **US-hosted**, the same reason we rejected fal for face *images* and built the EU BFL route. So the "easy" answer (fal.ai) reintroduces exactly the biometric-to-US transfer we just spent F023 avoiding.

**Verified this session:**
- **BFL has no video** — probed `api.eu.bfl.ai` `/v1/{video,flux-video,image-to-video,i2v,flux-2-video,svd,motion}` → all 404 (`/v1/video` → 403, likely a gated/unreleased path; BFL's site + research confirm image-only). So BFL cannot be the EU video route.
- **EU-resident managed candidate exists:** Google/Anthropic models are now offered with **EU data residency via Vertex AI** (EUrouter/Omnifact, 2026). So **Veo via Vertex AI pinned to an EU region** is the lead EU candidate — *pending verification that Veo specifically is available in an EU Vertex region with data residency* (the consumer Gemini API is US/global; Vertex-EU is the differentiator).

**Therefore the provider choice must split by data sensitivity, not just convenience:**
| Use case | Recommended route | Why |
|---|---|---|
| Face / personal video (Christian, a customer) | **EU path**: Veo via Vertex-AI-EU (verify) → else self-host (Wan 2.2 / LTX / SVD on Scaleway/OVH EU GPU) | biometric → EU residency required |
| Non-personal video (products, scenes, generic) | **fal.ai aggregator** (pluggable, already in stack, day-one models) | no personal data → convenience wins |
| Anything CN-hosted (Kling/Seedance/Hailuo direct) | **avoid for personal data** | CN transfer = hard no, like DeepSeek |

## Motivation

Christian wants to turn a generated portrait (F023) into a **short video** for an app. The natural follow-on to "auto-generate a photorealistic me" is "…now make it move." The SDK should own this as a first-class, cost-tracked, provider-pluggable capability — and crucially, carry the GDPR posture forward so a face video never silently lands on a US/CN host.

## Solution

A new **`ai.animate`** capability (image→video; `ai.video` is already taken by F019 video *understanding*). Pluggable provider via `override`, mirroring `ai.image`. Two adapters to start: **fal.ai** (aggregator, non-personal / consented use) and an **EU adapter** (Vertex-Veo-EU or self-host) for face/biometric video. Async long-running job (submit → poll) like the fal queue / Veo long-running-operation pattern. Real per-second cost stamped on `usage`.

## Scope

### In scope
- `ai.animate({ image: string|Uint8Array, prompt?, durationSec?, resolution?, override?, fallback? }) → { url, usage }` — capability + `animateInputSchema` + `AnimateRequest`/`AnimateResult` types + `ProviderAdapter.animate?`.
- **fal.ai `animate`** on the existing `falAdapter` (queue mode; model via `spec.model`, e.g. `fal-ai/bytedance/seedance-...`, `fal-ai/kling-video/...`, `fal-ai/veo/...`). Reuses fal's storage-upload for the input image (bytes → fal URL) + queue poll.
- **Cost**: per-second estimate per model (fal returns cost where available; else documented per-second rate), `usage.costUsd`. `Capability` union gains `"animate"`.
- One EU route (the open-question decision below) — at least scaffolded + documented even if behind a flag.
- Governance: consent-only, same as F023 (face video is the strictest case).
- Tests (injected-fetch): submit→poll→url, EU-pin assertion on the EU route, cost stamping. `docs/API.md` + changelog + Discovery ping.

### Out of scope
- Text-to-video (no input image) — this F-number is image→video; t2v can be a sibling later.
- Video *editing* / lip-sync / audio-dub (Grok's native audio is noted but not in scope v1).
- Long-form video — short clips (~3–10s) only.
- Self-host infra build-out — documented as the EU fallback, not built here unless option 2 is chosen.

## Architecture

### `ai.animate` (client.ts + schema)
`AnimateRequest { image, prompt?, durationSec?, resolution?, spec }` → `AnimateResult { url, usage }`. Default route = the chosen provider (open question). Override picks provider+model: `override:{ provider:"fal", model:"fal-ai/bytedance/seedance-v2-fast" }`.

### fal adapter `animate()`
Reuse `uploadToFalStorage` (bytes → fal URL) + `queueResult` (submit → poll). Body `{ image_url, prompt, duration }`. Extract the result video URL defensively (like `extractTrainedFiles`).

### EU adapter (decision pending)
- **A) Vertex-Veo-EU** — GCP service-account auth, `:predictLongRunning` on an EU regional endpoint, poll the operation. New `vertexAdapter` (separate from the consumer-Gemini adapter). Verify Veo+EU residency first.
- **B) Self-host** — Scaleway/OVH EU GPU running Wan 2.2 / LTX / SVD behind a small HTTP wrapper; SDK calls that endpoint. Full EU control, most infra.

## Stories
- **F024.1** — `ai.animate` capability + schema + types + `ProviderAdapter.animate?` + `Capability:"animate"` + client route/fallback wiring.
- **F024.2** — fal.ai `animate()` (queue, image-upload reuse, defensive video-URL extract) + per-second cost + tests. Default model Seedance Fast (override up). **The shippable core.**
- **F024.3** — `docs/API.md` + changelog + Discovery ping + governance/consent usage-contract note + a live smoke (consented portrait → short clip through `createAI()`).
- **F024.4** *(deferred)* — EU route (Vertex-Veo-EU or self-host) as the preferred head of the `fallback` chain — only if a non-consenting case or an EU upgrade is wanted later. Not needed for the current consent-gated use.

## Acceptance criteria
1. `ai.animate({ image, prompt })` returns a playable short-video URL + `usage.costUsd` (per-second), via an injected-fetch test (no live metered call in CI).
2. The fal route uploads the input image as bytes (no data-URI) and polls the queue to completion — tested.
3. The EU route asserts its endpoint is EU-resident (a unit test), mirroring the BFL EU-pin discipline; a face video never routes to a US/CN host by default.
4. Consent-only governance stated in the docstring + `docs/API.md` + Discovery entry.
5. `bun test` full suite green; `tsc --noEmit` clean; published via `publish.yml`.
6. One live smoke: a **non-personal** clip end-to-end through `createAI()` (documented); a consented face clip only once the EU route is verified.

## Dependencies
- Reuses fal's storage-upload + queue runner (F021). Independent of F022/F023. fal route needs `FAL_KEY` (present). EU route (A) needs GCP/Vertex creds; (B) needs EU GPU infra.

## Rollout
Additive. New capability + adapter(s); no change to existing routes. Ship the fal (non-personal) route first; the EU face route behind the chosen option. Ship-dark (inert without keys). Notify components for Discovery once live.

## Open Questions
1. ✅ **RESOLVED — default provider + EU posture:** fal.ai is the default; EU-preferred *when a route exists* via the `fallback` chain; customer consent is the GDPR basis (see Policy). No EU-pin blocker.
2. **EU route = Vertex-Veo-EU (A) or self-host (B)?** Deferred — not needed now (consent covers US/CN). Revisit only if a non-consenting customer appears or an EU upgrade is wanted. Verify Vertex-EU-Veo residency at that point.
3. **First fal model to wire** (Christian's call): **Seedance 2.0 Fast** (~$0.09/s, cheapest 1080p — the cheapest-good-enough default per the image tier-policy) vs **Veo 3.1 / Kling 3.0 Pro** (more cinematic) as the quality override? Recommendation: Seedance Fast default, override up for hero clips.
4. **Naming** — `ai.animate` (proposed) vs `ai.videoGen` vs `ai.imageToVideo`. `ai.video` is taken (F019 understanding). Recommendation: `ai.animate`.

## Effort estimate
**M–L** — ~1–2 days for the fal route + capability; the EU route (esp. self-host) adds more. Split so the fal/non-personal half ships independently of the EU/face half.
