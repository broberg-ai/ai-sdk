# F037 — Voice availability (a voice gate that can fall back)

> **Status: in progress — owner's go 2026-08-11.** Flagged by torrent-search-api via
> components (#19357). They call `ai.tts({voice:'christel'})` and found no counterpart
> to `resolveModel` for voices. Confirmed real. The open design question below is now
> **resolved in favour of A** by a finding neither side had at the start (#19384).
>
> **Two corrections made at implementation time — see "Corrections" at the bottom.**
> The scope below is the original; the corrections are what actually ships and why.

## The gap, verified in code

| | Models | Voices |
|---|---|---|
| Registry with status | `src/availability/registry.ts` | **none** |
| Resolve + fallback | `resolveModel()` | only name→id (`resolveVoice`, `resolveAzureVoice`) |
| Roster for a picker | `listModels()` | `listAzureDanishVoices()` (static) |

**The risk is ours, not just the consumer's.** We ship a *blessed* roster: 5 curated
ElevenLabs Danish voices (`ELEVENLABS_DANISH_VOICES`) and 6 Azure ones
(`AZURE_DANISH_VOICE_LIST`). If a provider retires one, our own default is broken for
every consumer using it, and nothing in the SDK notices. `christel` — the voice
contentpush uses for its promo videos — is one of them.

## How it actually fails (corrected 2026-08-10)

The first version of this plan said a retired voice "fails at the end user" loudly.
**That was wrong about the consumer, and the truth is worse.** torrent-search-api
catches the throw and logs it with a ⚠️, but their log view highlights only ❌/[ERROR].
A retired `christel` would have shown up as the house simply going quiet — with
nothing red to point at. Their phrasing: **hard throw, soft landing, silent result.**

They have since fixed their end (2 consecutive speech failures → ❌ [ERROR] naming the
voice; threshold 2, counter reset on every success, so a lone network blip doesn't
make red meaningless). Not a request to us — but it means a retired voice is a
*silent* fleet failure, which raises this from "annoying" to "invisible".

## The finding that settles the design

Consumer's vote: **A (static registry)**, arguing that a drifting registry beats no
registry because "the expensive thing isn't having wrong data — it's not being able to
SEE that it's wrong."

Testing that claim against our code produced the real argument, which is stronger than
either side's:

```ts
export function resolveVoice(nameOrId: string): string {
  return ELEVENLABS_DANISH_VOICES[nameOrId] ?? nameOrId;   // ← unknown = passthrough
}
```

**There is today no way to express "known, but dead".** Only two states exist:
*known-good* (in the map) and *unknown* (passed through verbatim as a raw voice id).
So if `christel` is retired and we "fix" it by deleting it from the curated map, the
call doesn't start failing gracefully — it starts POSTing the literal string
`"christel"` as a voice id, which fails **more** confusingly.

That means a registry is not primarily a drift-detector. It is the only way to *act on
a retirement at all*: even with perfect knowledge that a voice is dead, we currently
have no mechanism to say so. That is a missing tri-state
(**known-good / known-dead / unknown-passthrough**), and no amount of live checking
fixes it — B and C both still resolve through the same two-state function.

**Decision: A**, with the drift concern handled the way F034.1 taught us — make the
guard's staleness *visible* (a `checkedAt` on the registry, surfaced by `listVoices()`)
rather than pretending it cannot go stale. An optional refresh (mirroring
`availability/refresh.ts`) can layer on later without changing the call-site contract.

## Scope

- Voice registry with explicit status, mirroring `src/availability/registry.ts`:
  `known-good` / `known-dead` / unknown (passthrough, unchanged behaviour).
- `resolveVoice(requested, { fallback })` → `{ ok, voiceId, fellBack, reason }`,
  mirroring `resolveModel`'s shape so consumers learn one idiom. Existing one-arg
  calls keep working.
- `listVoices()` → `{ id, name, provider, locale, gender, available, checkedAt }` so a
  UI can grey out a dead voice — the F022 ergonomics torrent-search-api asked for.
- Both providers. A raw provider voice-id still passes through unchanged.

### Non-goals

- **No live provider lookup in v1.** Async I/O on the TTS path is a separate decision;
  the tri-state above is the part that cannot be solved any other way.
- No change to the curated Danish rosters themselves.
- Not a voice *picker* UI — this is the data behind one.

## Reuse

Checked before planning: no shared `@broberg/*` package owns TTS or voice metadata —
this repo is the fleet's AI primitive, and F022 (in this repo) is the pattern to
mirror. Nothing external to reuse.

## Trigger

Owner's go (given 2026-08-11). Reporting consumer: torrent-search-api. contentpush also
runs TTS (Azure, native da-DK, voice `christel`) and inherits the same risk.

## Stories

| | |
|---|---|
| **F037.1** | Voice registry with a `retired` state + `listVoices()` showing `checkedAt` |
| **F037.2** | `checkVoice()` — resolve with fallback, mirroring `resolveModel` |
| **F037.3** | `ai.tts` / `ai.podcast` refuse a known-dead voice (extends the scope above) |

## Corrections made at implementation time

### 1. The gate is called `checkVoice`, not `resolveVoice`

The scope above promised two things that cannot both be true: that
`resolveVoice(requested, {fallback})` returns `{ok, voiceId, fellBack, reason}`, **and**
that "existing one-arg calls keep working". `resolveVoice` returns a **string** today:

```ts
export function resolveVoice(nameOrId: string): string   // src/providers/elevenlabs.ts
```

It is called at `client.ts` (both `tts` and `podcast`) and re-exported from `index.ts`,
so it is part of the published API two peer repos may already call. Changing its return
type from `string` to an object breaks every call-site silently — the exact failure
class this feature exists to prevent.

So `resolveVoice` is left untouched (it is a *mapper*: name → id), and the gate ships as
**`checkVoice`** — the honest name, since it checks rather than maps. `listVoices()`
keeps the F022 symmetry with `listModels()`.

> Note: `elevenlabsAdapter().listVoices()` is a different thing — an async call to
> ElevenLabs' live API. The top-level `listVoices()` is synchronous, cross-provider, and
> reads only the curated registry.

### 2. F037.3 extends the scope: the client enforces the gate

The scope above stops at the data + the gate, mirroring F022 where buddy calls
`resolveModel` explicitly at spawn time. Applied to voices, that would not deliver this
epic's own promise.

**No TTS consumer calls a gate.** torrent-search-api and contentpush both call
`ai.tts({voice:'christel'})` directly. Ship only the gate, and the day `christel` is
retired both still break — silently, per the "hard throw, soft landing, silent result"
finding above — while the gate sits unused. That is precisely the failure this plan-doc
criticises, reproduced one layer up.

`ai.tts` and `ai.podcast` therefore consult the registry themselves. The blast radius is
exactly the voices we deliberately mark `retired`: a known-good voice and an unknown raw
provider id behave byte-identically to before. A voice we *know* is dead stops producing
a confusing provider error and starts producing `VoiceUnavailableError`, or falls back
when the caller passed `voiceFallback`.

### 3. A false retirement, caught before release — and the probe that caused it

While building F037.1 I probed all five curated ElevenLabs ids with
`GET /v1/voices/{id}`. Four returned 200; `mads` returned `voice_not_found`, stably,
three times, with a live control returning 200 each time. I marked it retired, wrote it
into the registry, cited it as evidence on the card, and shipped it in commit `7d6e9ab`
as "one of our five Danish voices is already dead".

**It was not dead.** `POST /v1/text-to-speech/BIWC0507fYMfhPcAEIRP` returns 200 and real
audio. The mistake surfaced only because the three *replacement candidates* I probed
next failed the same `GET` — and then synthesized perfectly. A voice that is
"not found" and also works is a contradiction, and the contradiction was in my
instrument, not in the provider.

**`GET /v1/voices/{id}` answers "is this voice saved in our account", not "can we use
this voice".** ElevenLabs serves public/shared voices for synthesis whether or not they
are in your library; `mads` is simply not saved to ours. The negative control I ran did
not catch it, because a fabricated id fails that endpoint too — the control proved the
probe could distinguish *something*, not that it distinguished *the right thing*.

Consequences, all applied:

- No curated voice is retired. All 11 ship `available:true`. The five ElevenLabs ids are
  re-verified by **synthesis** (200, five distinct sha256 outputs, fabricated id → 404),
  which is what `checkedAt: 2026-08-11` now means.
- `mads` keeps a `note` — usable, but no published metadata, hence no `gender`. **A
  caveat is not unavailability**; a picker must not grey it out. There is a test for
  exactly that confusion.
- The `retired` state is exercised through a test-only hook
  (`setRetiredVoicesForTests`), not by a real casualty. That is what the original AC
  asked for, before a false finding talked me out of it.
- This strengthens the "no live lookup in v1" non-goal with a better reason than async
  I/O: **ElevenLabs offers no free liveness check.** The only honest one costs a
  synthesis call. A cheap-but-wrong probe is worse than none, because it retires
  working voices.
