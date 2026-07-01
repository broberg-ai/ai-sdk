# F031 — Vertex AI Veo adapter (EU-resident `ai.animate`)

> Tier: provider/capability. Effort: S–M. Status: building. Deferred item from F024 ("F024.4") now taken up.

## Motivation

F024 shipped `ai.animate` (image-to-video) with Veo 3.1 **direct via the consumer Gemini API** (`GOOGLE_API_KEY`) as the default, and fal.ai as a pluggable aggregator alternative. Both are **US-hosted**. F024's plan-doc flagged the natural next step: *"the path to EU residency (Vertex) later"* — Veo is also servable through **Google Cloud Vertex AI**, which supports **EU regions** (`europe-west1/3/4/9`, `europe-north1`). For face/biometric video of a consenting person where EU data residency matters (the same reasoning that put BFL portraits and Azure TTS on EU-pinned routes), Vertex is the correct EU path — it is NOT a different model, just a different **hosting + auth surface** for the same Veo model family.

## Solution

Add a **`vertexAdapter`** implementing `ProviderAdapter.animate`, reusing the exact Veo request/poll/download shape already proven in `gemini.ts` (F024), but swapping: (a) the endpoint to a region-pinned Vertex host, (b) auth from an API key to a GCP **service-account OAuth2 Bearer token** (self-minted via `node:crypto`, zero extra deps), and (c) making the image-handling helpers (`toInlineImage`/`sniffMime`) shared instead of gemini-local, since two providers now need them. Opt-in via `override:{ provider:"vertex" }` — the existing US-default (`gemini`) is untouched.

## Scope

### In scope
- **`src/providers/media.ts`** (new, extracted) — `toInlineImage(image, fetchImpl)` + `sniffMime(bytes)`, moved out of `gemini.ts` (used verbatim there today) so `vertex.ts` can reuse them without duplicating ~25 lines of image-fetch/base64/mime-sniff logic. `gemini.ts` updated to import from here — no behavior change (existing gemini tests must stay green).
- **`src/providers/vertex.ts`** (new) — `vertexAdapter(config?)`:
  - **Auth**: GCP service-account JSON via `GOOGLE_VERTEX_CREDENTIALS` (inline JSON string) or `GOOGLE_APPLICATION_CREDENTIALS` (file path) or `config.credentials`. Mint a self-signed JWT (RS256 via `node:crypto`, scope `https://www.googleapis.com/auth/cloud-platform`) and exchange it at `https://oauth2.googleapis.com/token` (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`) for a Bearer access token; cache until ~60s before expiry. **Ship-dark**: no credentials → the adapter throws a clear error only when `animate()` is actually called, never at construction/import.
  - **Endpoint**: `https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/google/models/{model}:predictLongRunning`, `Authorization: Bearer <token>`. `region` defaults to `europe-west1` (config/`GOOGLE_VERTEX_REGION` override — always EU by default, this adapter's entire reason to exist). `project` from `config.project`/`GOOGLE_VERTEX_PROJECT` (required; no default — a stray Google Cloud project number must never be guessed).
  - **Body/poll/download**: byte-identical shape to `gemini.ts`'s proven Veo flow — `instances:[{prompt, image:{bytesBase64Encoded, mimeType}}]`, `parameters:{durationSeconds:<number>, resolution?}`; poll `GET {region-host}/v1/{operation.name}` until `done`; Vertex's long-running-operation video comes back either inline (`bytesBase64Encoded` in the response) or as a `gcsUri` — **this build handles the inline-bytes case** (the common one for a short clip); a `gcsUri` response throws a clear "not yet supported, ask for F031.x" error rather than silently failing.
  - Reuses `VEO_PRICE_PER_SEC`-equivalent pricing (Vertex Veo pricing = same per-second rate as the consumer API for the same model+resolution) — a local `VERTEX_VEO_PRICE_PER_SEC` table mirroring gemini.ts's, overridable via `config.pricePerSecond`.
- **`src/providers/vertex.test.ts`** — mocked-fetch coverage: JWT-mint + token-exchange call, submit body shape (region-pinned URL, Bearer header), poll-until-done, inline-bytes decode, `gcsUri`-response throws a clear "not supported" error, cost calc, ship-dark (no credentials → throws only on call).
- Register `vertex: vertexAdapter()` in `src/providers/registry.ts`; export `vertexAdapter` from `src/index.ts`.
- `docs/API.md` — note the Vertex EU-animate route under `ai.animate`.

### Out of scope
- **Changing `DEFAULT_ANIMATE_SPEC`** — `gemini` (US, consumer API) stays the default; Vertex is opt-in via `override`. No behavior change for existing callers (mirrors how Azure TTS and BFL portraits were added as opt-in, not default-flipping).
- **`gcsUri` output handling** (downloading from Google Cloud Storage) — deferred; throws a clear typed error if hit, rather than a silent wrong-shape crash. Candidate F031.x if a real Vertex response comes back that way.
- **Building the GCP project / enabling `aiplatform.googleapis.com` / provisioning a service account** — that is Christian's one-time GCP-console step (this SDK only *consumes* the resulting credentials JSON), the same division of labor as F026 (he created the Azure resource; the SDK consumed the key).
- **A live end-to-end video generation test in CI** — no CI secret for this; F031.3's live smoke is a manual, human-gated step (same pattern as F026.3).

## Architecture

### `vertexAdapter` (`src/providers/vertex.ts`)
```ts
export function vertexAdapter(config?: {
  credentials?: string;         // inline service-account JSON, else env GOOGLE_VERTEX_CREDENTIALS / GOOGLE_APPLICATION_CREDENTIALS (file path)
  project?: string;             // else env GOOGLE_VERTEX_PROJECT (required to call)
  region?: string;              // default "europe-west1"; else env GOOGLE_VERTEX_REGION
  fetch?: typeof fetch;
  pricePerSecond?: number;
  pollIntervalMs?: number;
  videoTimeoutMs?: number;
}): ProviderAdapter;
// animate(req): mint/cache Bearer token → POST .../predictLongRunning → poll → decode inline bytes
//   → { url: "vertex://<operation-name>" (no public URL exists), bytes, mimeType:"video/mp4", usage }
```
Internal: `mintAccessToken()` — builds `{alg:"RS256",typ:"JWT"}` header + claims (`iss`=client_email, `scope`, `aud`="https://oauth2.googleapis.com/token", `exp`=now+3600, `iat`=now), signs with `crypto.sign("RSA-SHA256", ..., privateKey)`, POSTs `x-www-form-urlencoded` grant to the token endpoint, caches `{token, expiresAt}`.

### Shared media helpers (`src/providers/media.ts`)
`toInlineImage`/`sniffMime` moved verbatim from `gemini.ts`; `gemini.ts` imports them. Pure refactor, no behavior change — asserted by keeping all existing `gemini.test.ts` assertions green.

## Stories
- **F031.1** — Extract `src/providers/media.ts`; `gemini.ts` imports from it; existing gemini tests stay green (pure refactor, no behavior change).
- **F031.2** — `vertexAdapter` (JWT auth + region-pinned predictLongRunning/poll/download, inline-bytes case) + registry/export + mocked-fetch tests.
- **F031.3** — Live EU smoke once Christian provides a GCP service-account JSON (`GOOGLE_VERTEX_CREDENTIALS` + `GOOGLE_VERTEX_PROJECT`), then `docs/API.md` note + release + ping components/cardmem with the shipped version.

## Acceptance criteria
1. `vertexAdapter().animate({...})` mints a Bearer token via the JWT→OAuth2 exchange (mocked in test), POSTs to `https://europe-west1-aiplatform.googleapis.com/v1/projects/{project}/locations/europe-west1/publishers/google/models/{model}:predictLongRunning`, with `Authorization: Bearer <token>` — verified by a mocked-fetch test asserting the exact URL + header.
2. Submit body matches the proven Veo shape (`instances[0].image.bytesBase64Encoded/mimeType`, `parameters.durationSeconds` as a NUMBER) — same assertions style as `gemini-animate.test.ts`.
3. Poll-until-`done`, then inline-bytes response decodes to `{ bytes, mimeType:"video/mp4" }`; a `gcsUri`-shaped response throws a clear, typed "not supported yet" error (not a silent wrong-shape crash) — both covered by tests.
4. `usage.provider==="vertex"`, `usage.capability==="animate"`, `usage.costUsd === perSecondRate * durationSec` — asserted.
5. Ship-dark: no `GOOGLE_VERTEX_CREDENTIALS`/`GOOGLE_VERTEX_PROJECT` → the adapter throws a clear error only when `animate()` is called (no import-time crash) — test covers it.
6. `src/providers/media.ts` extraction is behavior-neutral: full existing `gemini.test.ts` + `gemini-animate.test.ts` suites stay green unchanged.
7. Full `bun test` suite green; typecheck clean.
8. F031.3: one real EU-hosted Veo clip generated once Christian's service-account JSON is set; then version bumped + published via `publish.yml`; components + cardmem pinged with the shipped version.

## Dependencies
- Existing `ai.animate` capability + `ProviderAdapter.animate` (F024). No blocking SDK dependency.
- Christian provisions: a GCP project with `aiplatform.googleapis.com` enabled + billing linked, and a service-account JSON key with `roles/aiplatform.user` (the only human-gated step; mirrors F026's Azure-resource creation).

## Rollout
Additive, ship-dark, single-phase. New opt-in provider (`override:{provider:"vertex"}`); no change to `DEFAULT_ANIMATE_SPEC` or any existing caller. Rollback = drop the registry entry. Live use waits on F031.3 (credentials + smoke).

## Open Questions
1. **`gcsUri` support** — build now speculatively, or wait for a real response to confirm the shape? Chose: wait (Out of Scope above) — avoids guessing an untested code path; add as F031.x if hit live.
2. **Default flip** — should Vertex ever become the *default* `ai.animate` route once proven (EU-by-default for all animate calls, not just opt-in)? Deferred — Christian's call once F031.3's live smoke is proven and cost/reliability are compared to the Gemini-direct route.

## Effort estimate
**S–M** — ~0.5–1 day for F031.1+F031.2 (adapter + tests, no live creds needed); F031.3 is a short live smoke once Christian's service-account JSON lands.
