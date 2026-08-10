# F037 — Voice availability (a `resolveVoice` that can fall back)

> **Status: backlog, awaiting the owner's call.** Flagged by torrent-search-api via
> components (#19357). They call `ai.tts({voice:'christel'})` and found no counterpart
> to `resolveModel` for voices. Confirmed real. The open design question below is now
> **resolved in favour of A** by a finding neither side had at the start (#19384).

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

Owner's go. Reporting consumer: torrent-search-api. contentpush also runs TTS (Azure,
native da-DK, voice `christel`) and inherits the same risk.
