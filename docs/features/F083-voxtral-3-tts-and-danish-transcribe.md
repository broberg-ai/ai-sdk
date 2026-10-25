# F083 — Voxtral 3 i ai.tts og dansk ai.transcribe (Mistral, EU)

> Ejerens ordre 25/10 2026. High. Effort S–M. Status: i gang.

## Summary
Mistrals nye oplæsningsmodel Voxtral TTS 3 bliver en rute bag `ai.tts`, så apps kan få tekst læst op med data i EU. Mistrals nye tale-til-tekst Voxtral Small Transcribe 3, der forstår dansk, bliver en dokumenteret rute bag `ai.transcribe`. Begge bruger den Mistral-nøgle apps allerede har.

## Motivation
I dag går `ai.tts` til ElevenLabs (standard) eller Azure, og den eneste danske EU-tale-til-tekst er Azure da-DK. Christian så Voxtral 3 i Mistrals konsol 24/10 og bad om en test. Målt 25/10 på vores nøgle:
- `POST https://api.mistral.ai/v1/audio/speech` med `voxtral-mini-tts-3` gav lyd på ca. 3 s for en dansk sætning. 66 stemmer, ingen mærket dansk. Heidi (`voice_481`, tysk) og Lars (`voice_3134`, norsk) blev begge godkendt af Christian; han finder Heidi bedst på dansk.
- Lydfilerne kom ordret tilbage gennem `voxtral-small-transcribe-3` med `language=da` (Lars-filen inkl. «Rødgrød med fløde»).
- Den gamle `voxtral-mini-tts-2603` afviser stemmerne («voice is not supported for speech v1»). Den gamle `voxtral-mini-latest` (transcribe) afviser `da`.
- `voice_id` tager både slug (`voice_481`) og UUID; et navn (`Heidi`) giver 404. `model` er påkrævet (422 uden).
- Svaret er JSON `{ audio_data: <base64> }`; `response_format`: pcm, wav, mp3, flac, opus.
- Svaret kom via Cloudflare København-kant (`cf-ray -CPH`); `api.mistral.ai` giver `region: "eu"` via `regionOfHost`.

## Solution
`mistralAdapter` får en `tts()` mod `/v1/audio/speech`. Kaldes med `ai.tts({ text, voice: "voice_481", override: { provider: "mistral" } })`. Transcribe virker allerede via `mistralAdapter.transcribe` — der mangler pris/registry-rækker, en pinnet model og dokumentation af dansk.

## Reuse
- LLM/tale-adgang: dette ER `@broberg/ai-sdk`; ingen ny pakke. Eksisterende `mistralAdapter`, `applyPronunciations`/`assertPronunciations` (F051), `regionOfHost`, `freshUsage`, `getMediaPrice`.
- Discovery: ingen anden `@broberg/*`-pakke ejer TTS/STT; ai-sdk er ejeren. components får besked ved udgivelse.

## Design
None — no visual surface.

## Scope

### In scope
- `src/providers/mistral.ts`: `tts(req)` — body `{ model, input, voice_id, response_format }`, base64 → bytes, mime fra format, usage med region fra URL.
- Model: `req.spec.model` hvis det er en `voxtral-*-tts-*`-model, ellers `voxtral-mini-tts-3-0` (pinnet, dateret navn fra Mistrals docs). Nødvendigt fordi `ai.tts` merger override uden model (ruter på stemme), så spec.model ellers er ElevenLabs' modelnavn.
- Udtale (F051): `alias` anvendes som tekst-substitution (som ElevenLabs). `ipa` KASTER med en besked der nævner azure — Mistrals `phoneme_hints` kræver opsplitning i deres fon-liste og er ikke med her.
- `format`: mp3 (standard) | wav | pcm | flac | opus; andet kaster.
- `rate`, `wordTimings`: ikke understøttet — `wordTimings:true` kaster (samme princip: aldrig tavst ignoreret).
- Pris: Mistral offentliggør kun «per minute» uden beløb (læst 25/10). Kald bogføres `costUsd: 0`, `costBasis: "unpriced"` — aldrig et gættet tal.
- Transcribe: registry-række for `voxtral-small-transcribe-3-0` med note «dansk målt 25/10»; docs for dansk EU-tale-til-tekst via `override:{provider:"mistral", model:"voxtral-small-transcribe-3-0"}`.
- Docs (`docs/API.md`, CLAUDE.md EU-ruter-tabel), udgivelse, Discovery.

### Out of scope
- At gøre Mistral til standard for `ai.tts` (ElevenLabs forbliver standard — ejerens valg).
- `phoneme_hints` (IPA → Mistrals fon-liste), emotion-/pace-tags, streaming, egne stemmer (voice cloning).
- Mistral i `ai.podcast` (dialog).
- Ordtidskoder fra Voxtral.

## Architecture
```ts
// src/providers/mistral.ts
async function tts(req: TtsRequest): Promise<PodcastResult>
// POST ${baseUrl}/audio/speech  { model, input, voice_id: req.voiceId, response_format }
// → { audio_data: base64 }  → { audio: Uint8Array, mimeType, usage }
```
Konstant `MISTRAL_TTS_DEFAULT_MODEL = "voxtral-mini-tts-3-0"` i mistral.ts. Mime-map: mp3→audio/mpeg, wav→audio/wav, pcm→audio/pcm, flac→audio/flac, opus→audio/ogg.

## Stories
- **F083.1** — `mistral.tts` bag `ai.tts`, live-målt på dansk med Heidi.
- **F083.2** — dansk tale-til-tekst via `voxtral-small-transcribe-3-0`: registry, docs, live-måling.
- **F083.3** — docs, udgivelse og Discovery.

## Acceptance criteria
1. `ai.tts({ text: <dansk>, voice: "voice_481", override:{provider:"mistral"} })` returnerer afspillelig mp3 med `usage.region === "eu"` — målt live.
2. Lyden transskriberes tilbage ordret nok af `voxtral-small-transcribe-3-0` med `language:"da"` — målt live.
3. `ipa`, ukendt format og `wordTimings:true` kaster med beskeder der navngiver alternativet — unit-test.
4. Release på npm og components informeret.

## Dependencies
None.

## Rollout
Additivt (ny override-rute). Minor-bump. Standarder uændrede.

## Open Questions
1. Mistrals pris pr. minut for TTS 3 og Transcribe 3 er ikke offentliggjort (læst 25/10) — kald står som `unpriced` indtil tallet findes; tjekkes ved næste /model-research.

## Effort estimate
**S–M** — ½–1 dag.
