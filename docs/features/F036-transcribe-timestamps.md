# F036 — Timestamps on `ai.transcribe` (a timing source for captions)

> **Retroactive plan-doc.** This shipped as v0.25.0 + v0.25.1 (2026-07-17/18) before a
> card existed — commits `619565a` and `54389c4` reference F036/F036.1 with nothing on
> the board behind them. Written now to close that traceability gap, not to plan future
> work. Created directly in Done because the work is live on npm.

## Motivation

contentpush F016.5 needed time-synced captions for promo videos and had no timing
source: `ai.transcribe` returned only `{ text, usage }`.

Two routes were considered:

- **Whisper word/segment timestamps** — native (`response_format=verbose_json` +
  `timestamp_granularities[]`). Cheap, additive. **Chosen.**
- **Azure TTS word-boundary events** — would give perfect sync with no extra call,
  since the consumer generates the speech itself. **Rejected:** our Azure adapter uses
  the REST endpoint (`cognitiveservices/v1`), which returns audio bytes only.
  `SpeechSynthesisWordBoundary` is emitted only by the Speech SDK over WebSocket — a
  transport re-architecture for a case transcription already covers.

## Scope (as shipped)

`ai.transcribe({ audio, timestamps: "word" | "segment" | ("word"|"segment")[] })`
→ `TranscribeResult` gains `words?: {word,start,end}[]` and
`segments?: {text,start,end}[]`. Omitting `timestamps` returns the unchanged
`{ text, usage }` shape.

- **v0.25.0** — openai/Whisper adapter: request `verbose_json` + a granularity per
  requested level; parse `words` (only when "word" was asked for) and `segments`.
- **v0.25.1 (F036.1)** — the gap contentpush hit in production: timestamps worked
  **only** on Whisper. Azure and Mistral silently ignored the flag, so an
  Azure-key-only repo could not use the API as documented. Azure fast-transcription
  already returned `phrases[]` with per-word ms offsets — the adapter just dropped
  them. Now parsed (ms→sec) onto the same result shape.

### Non-goals

- **Voxtral/Mistral timestamps.** Left unbuilt: no verified response shape, and
  fabricating a parser for an unverified format is exactly the kind of untested claim
  this repo forbids. The provider support matrix is documented on the schema so the
  API is not announced as universal.

## Reuse

Internal to `@broberg/ai-sdk`'s own transcribe capability — no shared `@broberg/*`
package owns speech-to-text. Nothing to reuse or extend elsewhere.

## Rollout

Shipped and live on npm. contentpush adopted it for F016.5 captions on the Azure
(EU, native da-DK) route, replacing an estimate-based ÷150 distribution.

## Lesson carried forward

v0.25.0 shipped an API that read as universal but worked on one provider. The
follow-up (F036.1) fixed the package rather than leaving each consumer to work around
it, and the provider support matrix is now stated explicitly rather than implied.
