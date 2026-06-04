# F020 — Instant Podcast Generation (`ai.podcast`) via ElevenLabs

> A new SDK capability: an app sends a **finished manuscript** (multi-speaker script) and ai-sdk returns a **finished podcast episode** (one multi-voice audio file), Danish-capable. Built on ElevenLabs Text-to-Dialogue (eleven_v3). Tier: capabilities/provider. Effort: M. Status: planned.

## Motivation

Christian's apps already produce a finished podcast manuscript. They need that turned into an actual episode — multiple distinct voices, natural delivery, **in Danish** — without each app hand-rolling an ElevenLabs client and its own cost tracking (the standing rule: all AI through @broberg/ai-sdk). The goal is **instant**: manuscript in → episode out, one call.

## Research — what others do (incl. the requested podcastfy)

- **[podcastfy](https://github.com/souzatharsis/podcastfy)** (the Python ref Christian pointed to): a 3-stage pipeline — **content → transcript (LLM) → audio (TTS)**. It ingests websites/PDFs/YouTube/text/images, generates a 2-host conversational transcript via any of 100+ LLMs, then synthesizes audio across multiple TTS backends (OpenAI, Google, **ElevenLabs**, Edge), with a v0.4+ multi-speaker TTS mode. Configurable style/length (shorts 2-5 min ↔ longform 30+ min), language, structure.
- **[ElevenLabs Text-to-Dialogue (eleven_v3)](https://elevenlabs.io/docs/overview/capabilities/text-to-dialogue)**: the single most relevant primitive. One request takes an `inputs[]` array of `{text, voice_id}` turns and returns **one cohesive multi-speaker audio file** — the endpoint auto-manages speaker transitions, emotion, and interruptions. 70+ languages incl. **Danish**; audio tags (`[laughs]`, `[whispers]`, `[sad]`) inline in the text shape delivery. ([blog](https://elevenlabs.io/blog/eleven-v3-audio-tags-bringing-multi-character-dialogue-to-life), [v3](https://elevenlabs.io/v3))
- **Key insight from the research:** podcastfy's value is mostly its **content→transcript** half (the part that turns arbitrary source material into a script). Christian's apps already own that half — they send a finished manuscript. So **ai-sdk only needs the transcript→audio half**, which ElevenLabs Text-to-Dialogue does natively in one call. That makes "instant" real and the SDK surface tiny.

### Decision: don't port podcastfy wholesale
Porting the whole Python package to TS is the wrong move — it's a large multi-purpose tool (content extractors, LLM transcript-gen, multi-backend TTS orchestration, audio stitching) and ~80% of it is content-ingestion + transcript-generation that our apps (or a thin `ai.chat`) already cover. We **reimplement the relevant pattern natively in TS** — a clean `ai.podcast` over ElevenLabs Text-to-Dialogue — taking podcastfy's multi-speaker + voice-config + conversation-style ideas as design inspiration, not as code to translate.

## Solution

An **ElevenLabs provider adapter** (Text-to-Dialogue + single-voice TTS + voice list) and an **`ai.podcast({ script, voices })`** capability that maps a finished manuscript (speaker turns) + a voice map to one Text-to-Dialogue call → one episode audio (`{ audio, mimeType, usage }`). Danish via eleven_v3 multilingual. Per-character cost.

## Scope

### In scope
- `src/providers/elevenlabs.ts` — adapter: `dialogue()` (POST `/v1/text-to-dialogue/convert`, `inputs:[{text,voice_id}]`, `model_id:"eleven_v3"`, `output_format`), plus single-voice `tts()` (POST `/v1/text-to-speech/{voice_id}`) and `listVoices()` (GET `/v1/voices`). Auth `xi-api-key`. Key `ELEVENLABS_API_KEY`.
- `ai.podcast({ script, voices, model?, format? })` capability (`src/capabilities/podcast.ts`): `script` = ordered turns `[{ speaker, text }]` (or a tagged manuscript string we parse); `voices` = `{ speaker → voiceId }` map → ElevenLabs dialogue → `{ audio: Uint8Array, mimeType:"audio/mpeg", usage }`.
- Voice config helpers: a small named-voice registry (e.g. `{ "vært-1": "<voiceId>" }`) + `ai.podcast`-time mapping so apps pass friendly names; `listVoices()` to discover IDs.
- Cost: **per-character** (ElevenLabs bills per character). usage.costUsd = totalChars × ratePerChar (config-overridable; default from the API-tier overage ≈ $0.10–0.18/1k chars). Audio tags excluded from the billable count if the API does.
- ElevenLabs can ALSO back the F016.3 `ai.tts` single-voice capability (better Danish than Voxtral) — wire as an option.
- Tests: offline (injected fetch) for dialogue/tts request shape + cost; one live smoke producing a real Danish 2-voice clip.

### Out of scope (this epic)
- The **content → transcript** half (arbitrary source → script). Apps own the manuscript. (A future optional `ai.podcast` mode could generate a transcript via `ai.chat` first — see Open Questions / a possible F020.5.)
- Audio stitching / editing / music beds / chapter markers. Text-to-Dialogue returns one finished file; post-production is the app's job.
- Non-ElevenLabs TTS backends (OpenAI/Google/Edge) — ElevenLabs only for now (best Danish + native multi-speaker).
- Voice cloning / custom voice creation.

## Architecture

### ElevenLabs adapter — `src/providers/elevenlabs.ts`
```ts
elevenlabsAdapter({ apiKey?, baseUrl?, fetch?, pricePer1kChars? })
// dialogue(req): POST {baseUrl}/text-to-dialogue/convert
//   body { inputs:[{text, voice_id}], model_id:"eleven_v3", output_format?, settings? }
//   headers { "xi-api-key": key, accept:"audio/mpeg" } → audio bytes
// tts(req): POST {baseUrl}/text-to-speech/{voice_id}  (single voice)
// listVoices(): GET {baseUrl}/voices
```
`baseUrl` default `https://api.elevenlabs.io/v1`. Output default MP3 (`audio/mpeg`); other formats (PCM/Opus) optional.

### `ai.podcast()` — `src/capabilities/podcast.ts`
```ts
ai.podcast({
  script: { speaker: string; text: string }[],   // the finished manuscript, in order
  voices: Record<string, string>,                 // speaker → ElevenLabs voiceId
  model?: string,                                  // default eleven_v3
  format?: "mp3" | "pcm" | "opus",
  override?, purpose?, labels?,
}) → { audio: Uint8Array; mimeType: string; usage: Usage }
```
Maps each `{speaker,text}` to `{ voice_id: voices[speaker], text }`, posts one Text-to-Dialogue request, returns the episode audio. New `ProviderAdapter.dialogue?` method (ElevenLabs only). A `podcast` default spec routes to elevenlabs (no tier).

### Cost
Per-character. `usage.costUsd = chars × ratePerChar` (set in the adapter, like OCR per-page). A 5-minute episode ≈ a few thousand chars ≈ well under $1.

## Stories
- **F020.1** — ElevenLabs provider adapter (`dialogue` + `tts` + `listVoices`), `xi-api-key`, MP3 out, per-character cost.
- **F020.2** — `ai.podcast({script, voices})` capability over Text-to-Dialogue; manuscript turns → one Danish multi-voice episode. Offline tests + 1 live smoke.
- **F020.3** — Voice config: named-voice registry + `listVoices()` discovery so apps pass friendly speaker names; document picking Danish voices.
- **F020.4** — Wire ElevenLabs into the existing `ai.tts` (F016.3) as a single-voice option (better Danish than Voxtral); docs/API.md for `ai.podcast` + `ai.tts`.

## Acceptance criteria
1. `ai.podcast({ script:[{speaker:"A",text},{speaker:"B",text}], voices:{A:id1,B:id2} })` returns a real multi-voice MP3 episode from a live ElevenLabs call (Danish script → Danish speech).
2. `usage.costUsd` is non-zero and per-character (no $0 under-count).
3. Each speaker's turns use the mapped `voice_id`; speaker order is preserved (verified offline against the request body).
4. Audio tags (`[laughs]` etc.) pass through unmodified in the turn text.
5. Offline tests (injected fetch) + 1 live smoke; typecheck clean, suite green; `ai.podcast` + `ai.tts` documented in docs/API.md.

## Dependencies
- An **`ELEVENLABS_API_KEY`** for the live smoke + the eleven_v3 plan tier (Christian provides, like the Mistral/Gemini/OpenRouter keys).
- Existing `runCapability` + cost plumbing — reused.
- Confirm the exact `/v1/text-to-dialogue/convert` request body + the eleven_v3 model id against [the API reference](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert) (see Open Questions).
- Relates to F016.3 `ai.tts` (Voxtral) — ElevenLabs becomes a second TTS backend.

## Rollout
Single-phase, additive — a new provider + `ai.podcast` capability; nothing existing changes. Ships in the rolling v0.x line once live-verified with an ElevenLabs key. Rollback = the capability is inert unless called.

## Open Questions
- **Exact Text-to-Dialogue request body** — confirm `inputs` vs another field name, the eleven_v3 `model_id` string, and `output_format` enum against the live API reference before building F020.1.
- **Plan tier / credits** — eleven_v3 + Text-to-Dialogue availability depends on the ElevenLabs plan; confirm the key's tier. Per-character overage rate for the cost model (~$0.10–0.18/1k chars).
- **Manuscript format** — do apps send structured turns `[{speaker,text}]` (clean) or a tagged string (`HOST: …\nGUEST: …`) we must parse? Plan assumes structured turns; add a parser if needed.
- **Optional content→transcript mode (future F020.5?)** — should `ai.podcast` also accept raw content and generate the 2-host transcript via `ai.chat` first (NotebookLM-style "podcast from anything")? Out of scope now; the apps own the manuscript.
- **Danish voices** — which ElevenLabs voiceIds sound good in Danish? Curate a few via `listVoices()` + a listen test.

## Effort estimate
**M** — ~1.5–2 days. F020.1 adapter (~0.5d), F020.2 capability + live smoke (~0.5d), F020.3 voice config (~0.5d), F020.4 ai.tts wiring + docs (~0.25d). Smaller than it looks because Text-to-Dialogue does the multi-speaker synthesis in one call — no stitching to build.
