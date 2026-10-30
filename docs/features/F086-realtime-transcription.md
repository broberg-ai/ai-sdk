# F086 — Tale-til-tekst i realtid (`ai.transcribeStream`)

> Ejeren 31/10 2026: «Ja, lav et kort alligevel.» Low (ingen kunde venter). Effort M. Status: backlog, interim-plan med åbne spørgsmål.

## Open Questions (først — skal afklares før bygning)
1. **Hvem skal bruge det?** Ingen app har bestilt realtime endnu. Kandidater: undertekster i Scope-møder (cardmem), diktat i Jam («eller bare diktér»), voice-engine. Bygges først når én konkret forbruger er navngivet (ejerens princip: ingen penge uden beviselig effekt).
2. **Dansk?** Mistrals realtime-side nævner ingen sprog. Den ikke-realtime Voxtral Mini-model afviste `da` (målt 25/10); Small Transcribe 3 tog dansk, men findes ikke i realtime. Skal måles på `voxtral-mini-transcribe-realtime-3-0` før noget lover dansk.
3. **Server eller browser?** Mistral har en «Client authentication»-side for browser-klienter. ai-sdk kører server-side; en browser-forbindelse kræver kortlivede tokens, aldrig vores nøgle i browseren.
4. **Docs er markeret «Deprecated»** i Mistrals menu og nævner kun `-2602`-modellen. Wire-formatet skal måles mod den nye `-realtime-3-0` før koden låses.

## Summary
En ny funktion i ai-sdk, hvor en app sender lyd løbende ind (fx fra en mikrofon) og får teksten tilbage undervejs, mens der tales — i EU via Mistral. I dag kan `ai.transcribe` kun tage en færdig lydfil.

## Motivation
Mistrals mail 30/10 2026: `voxtral-mini-transcribe-realtime-2602` udfases 2027-04-30; afløser `voxtral-mini-transcribe-realtime-3-0` til $0,008/min. F085.4 gav alle andre modeller fra mailen en dør; realtime blev udeladt, fordi den kræver en åben forbindelse (WebSocket) og ikke passer i det nuværende spørgsmål-svar-mønster. Modellen findes på vores nøgle (/v1/models, målt 25/10).

## Solution
Ny kapabilitet `ai.transcribeStream(input)` der returnerer en async iterator af hændelser, i samme stil som `ai.chatStream`. Mistral-adapteren åbner `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=…`, sender PCM-lyd og oversætter serverens hændelser.

Kendt fra Mistrals docs (læst 31/10, siden er markeret «Deprecated»):
- Endpoint `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=<model>` (model påkrævet).
- Lyd: `pcm_s16le`, 16 kHz (8/16/22,05/44,1/48 kHz accepteret af deres demo).
- `target_streaming_delay_ms` (fx 240 hurtig / 2400 præcis).
- Hændelser (SDK-navne): session created, text delta (`text`), done, error (`error`).
- Ikke kompatibel med `diarize`.

## Reuse
- Ingen `@broberg/*`-pakke ejer realtime-tale; ai-sdk er ejeren. Event-mønstret genbruger `chatStream`'s async-iterator-kontrakt (`ChatStreamEvent`-stil) og eksisterende `freshUsage`/`regionOfHost`/`getMediaPrice`.
- WebSocket: Bun og Node ≥22 har global `WebSocket` — ingen ny afhængighed [Likely, verificéres].

## Design
None — no visual surface.

## Scope

### In scope
- `src/types.ts`: `TranscribeStreamEvent` (`{type:"delta", text}` | `{type:"done", text, usage}` | `{type:"error", message}`), `ProviderAdapter.transcribeStream?`.
- `src/providers/mistral.ts`: `transcribeStream(req)` — WebSocket, auth, PCM-afsendelse fra en `AsyncIterable<Uint8Array>`, hændelses-oversættelse, luk pænt.
- `src/client.ts`: `ai.transcribeStream({ audio: AsyncIterable<Uint8Array>, sampleRate?, language?, delayMs?, override })`.
- Pris: minutter målt på sendt lyd × $0,008 (`media-pricing.ts` har allerede rækken), bogført ved `done`; region fra host.
- Tests med en falsk WebSocket; én live-måling (engelsk + dansk forsøg).

### Out of scope
- Browser-direkte forbindelse og kortlivede tokens (eget kort, hvis en forbruger kræver det).
- Talegenkendelse af hvem der taler (diarize).
- Andre udbyderes realtime (Azure, OpenAI).

## Stories
- **F086.1** — `ai.transcribeStream` via Mistral, testet med falsk WebSocket, live-målt, udgivet.

## Acceptance criteria
1. Unit-test med falsk WebSocket: lyd sendes som PCM, delta-hændelser kommer ud i rækkefølge, `done` bærer samlet tekst og usage.
2. Live: en optaget engelsk klip streamet i bidder giver løbende tekst og en færdig tekst der matcher; `usage.region === "eu"`, pris = minutter × $0,008.
3. Dansk målt og resultatet skrevet i docs (virker / virker ikke), ikke antaget.
4. Fejl fra serveren og afbrudt forbindelse giver en `error`-hændelse, aldrig en stille hængende iterator.

## Dependencies
F085.4 (prisrækken for realtime-3-0 findes).

## Rollout
Additivt, minor. Ingen standardændring.

## Effort estimate
**M** — 1 dag, når en forbruger er navngivet.
