# F038 — EU-resident vision + video analysis on the Vertex adapter

## Motivation

**Personal data is being analysed outside the EU today, and we have no alternative to
offer.** xrt81 analyses club photos and videos containing faces and EXIF geo-location;
components escalated it (#19389) after xrt81 found their PII path ran Mistral *through
OpenRouter* (a US company) — an EU-sounding model name over a non-EU route.

The still-image half is solved: `override:{provider:"mistral"}` is a genuine EU route
and xrt81 now has a Mistral key. **The video half had no answer at all.** Verified
2026-08-10:

- `video` tier → `gemini-2.5-flash-lite` = US (`tier-map.ts:26`).
- `vertexAdapter` returns **only `animate`** (`vertex.ts:212`) — generation, not
  analysis. No `vision` method, so no EU analysis route exists through it.
- Mistral: our transport encodes a video part as `video_url`, but Mistral's documented
  vision is *images*. Unverified for video — and we do not guess on face data.

So the honest answer to xrt81 was "no EU route exists". This closes that.

## What unblocked it

The work was never hard — it was blocked on GCP credentials only Christian could
create. Done 2026-08-11: `roles/aiplatform.user` granted to the existing ai-sdk service
account (least privilege — no owner), key minted into the gitignored `.env` as
`GOOGLE_VERTEX_CREDENTIALS`.

**Where the key lives.** A gitignored `.env` on one Mac is not durable — lose the
machine and the EU route dies with it. The key is therefore also in cardmem's
Secrets Vault: secret id `019ff120-5dfa-716c-8f93-931a69560050`, project `ai-sdk`,
mapped to env var `GOOGLE_VERTEX_CREDENTIALS`. It was written straight from disk
over HTTPS, so the value never passed through an LLM context.

Restore-tested end-to-end 2026-08-11, not assumed: fetched back from the vault →
byte-identical to `.env` → minted an OAuth token from the *vault copy alone* →
`europe-west1` answered HTTP 200. A backup you have never restored from is a
claim, not a backup.

**First live EU verification ever** (F031 was code-complete but never proven):
token mints, and `gemini-2.5-flash` answers HTTP 200 from **both** `europe-west1` and
`europe-west4`.

## Scope

Add `vision` to `vertexAdapter`, region-pinned to EU, so `ai.vision` and `ai.video`
can route there via `override:{ provider:"vertex" }`:

- Reuse the adapter's existing JWT token-minting and region pinning — no new auth path.
- Accept the SDK's existing multimodal message shape: text, image and **video** parts,
  mapped to Vertex `inlineData` (base64) / `fileData` (gs:// URI).
- Cost-tracked through the same `Usage` path as every other capability.
- **No silent US fallback.** If the EU region errors, the call fails — it must never
  quietly reach a non-EU region. A fallback chain remains caller-controlled, and that
  is a GDPR decision the caller makes explicitly.

### Non-goals

- Not changing the default `video` tier. Default stays as-is; EU is an explicit
  override, because switching every consumer's default silently is exactly the kind of
  fleet-wide change that caused the F034 traps.
- Not Veo/animate — already shipped (F031), now finally verifiable with these creds.

## Reuse

Checked before building: no shared `@broberg/*` package owns model access — this repo
IS the fleet's AI primitive. Internal reuse only: the vertex adapter's own
`accessToken()` + region pinning, and the existing `buildVideoMessages` /
`buildVisionMessages` capability helpers.

## Rollout

Additive: a new method on an existing adapter, reachable only by explicit override. No
existing call-site changes behaviour. xrt81 is the waiting consumer.
