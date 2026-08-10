# F037 — Voice availability (a `resolveVoice` that can fall back)

> **Status: backlog, with an OPEN DESIGN QUESTION (see below).** Flagged by
> torrent-search-api via components (#19357). They call `ai.tts({voice:'christel'})`
> and found no counterpart to `resolveModel` for voices. They asked for nothing — they
> reported a hole they cannot close from their side. Confirmed real; the design is not
> a copy of F022 and needs a decision before code.

## The gap, verified in code

| | Models | Voices |
|---|---|---|
| Registry with status | `src/availability/registry.ts` | **none** |
| Resolve + fallback | `resolveModel()` | only name→id (`resolveVoice`, `resolveAzureVoice`) |
| Roster for a picker | `listModels()` | `listAzureDanishVoices()` (static) |

`resolveVoice(nameOrId)` passes an unknown string straight through, and the adapter
POSTs it to `/text-to-speech/{voice_id}`; a retired id returns non-200 and
`elevenlabs.ts:89` throws. So a retired voice fails **at the end user**, exactly as a
suspended model did before F022 — the precedent this repo already accepted.

**The risk is ours, not just the consumer's.** We ship a *blessed* roster: 5 curated
ElevenLabs Danish voices (`ELEVENLABS_DANISH_VOICES`) and 6 Azure ones
(`AZURE_DANISH_VOICE_LIST`). If a provider retires one, our own default is broken for
every consumer using it — and nothing in the SDK notices.

## OPEN QUESTION — where does voice truth come from?

F022's harness is deliberately **sync, zero-I/O**: a hardcoded registry, safe on a hot
path and in a browser build. Voices cannot simply copy that:

- **A) Static registry (mirror F022).** Zero-I/O, browser-safe, identical ergonomics.
  Cost: a hand-maintained list that drifts — and a voice retired upstream stays
  "available" in our registry until someone edits it. Drift is precisely what the
  guard is supposed to catch, so this risks a green light that proves nothing.
- **B) Live check against the provider.** Both providers expose a roster
  (`listVoices()` already exists on the ElevenLabs adapter; Azure has voices/list).
  Always truthful, but async + network on a path that is currently neither, and it
  costs a round-trip per resolve unless cached.
- **C) Graceful fallback at call time.** Leave resolution alone; catch the
  voice-not-found error in the adapter and retry once with a same-gender/same-locale
  voice from the curated roster. No new I/O, no registry to drift — but it only helps
  *after* a failure, and it cannot grey out a dead voice in a picker.

A hybrid (B refreshing A, like `availability/refresh.ts` does for models) is the
likeliest answer, but it is a real decision about I/O on the TTS path — not a
mechanical port. **Do not build until this is decided.**

## Scope (once decided)

- `resolveVoice(requested, { fallback })` → `{ ok, voiceId, fellBack, reason }`,
  mirroring `resolveModel`'s shape so consumers learn one idiom.
- `listVoices()` returning `{ id, name, provider, locale, gender, available }` so a UI
  can grey out a dead voice — the F022 ergonomics torrent-search-api is asking for.
- Cover both providers; a raw provider voice-id still passes through unchanged.

### Non-goals

- No change to the curated Danish rosters themselves.
- Not a voice *picker* UI — this is the data behind one.

## Reuse

Checked before planning: no shared `@broberg/*` package owns TTS or voice metadata —
this repo is the fleet's AI primitive, and F022 (in this repo) is the pattern to
mirror. Nothing external to reuse.

## Trigger

A consumer hitting an actually-retired voice, or a decision on the open question
above. torrent-search-api is the reporting consumer; contentpush also runs TTS
(Azure, native da-DK) and would benefit from the same guard.
