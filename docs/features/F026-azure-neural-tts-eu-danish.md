# F026 — Azure Neural TTS provider (EU Danish) behind `ai.tts`

> Tier: capability/provider. Effort: S–M. Status: building. Consumer: cardmem F160 (natural plan-readaloud).

## Motivation

cardmem's F160 wants **natural neural Danish read-aloud** of plans (Reader + plan-drawer + chat share one engine; today browser `SpeechSynthesis`, whose Danish "lyder elendigt"). That hangs on a TTS capability here. The `ai.tts({ text, voice })` capability already ships (F020.4) — but only behind **ElevenLabs** (US, ~$0.15/1k chars, expressive but inconsistent Danish for long-form narration). For clear, natural, EU-resident Danish narration the better engine is **Azure Neural TTS** (`da-DK-ChristelNeural` / `da-DK-JeppeNeural`): purpose-built natural Danish, **EU-hosted** (`westeurope` = GDPR-clean), and ~10× cheaper (~$0.016/1k chars). Azure Speech is NOT reachable via OpenRouter (OpenRouter proxies LLM chat/completions only) — it needs its own direct adapter. (Christian's hypothesis "Azure works through OpenRouter" was checked + corrected.)

## Solution

Add an **`azureAdapter`** (Azure Speech / Cognitive Services TTS) implementing the existing `ProviderAdapter.tts` hook, reachable via `ai.tts({ text, voice, override:{ provider:"azure", model:"neural" } })`. EU-region-pinned (`westeurope`), SSML request, MP3 out, char-billed cost-tracked through the same `upmetricsSink` as every other call. Ship-dark: no key → the adapter throws only when called; nothing else changes. Existing ElevenLabs `ai.tts` path is untouched.

## Scope

### In scope
- `src/providers/azure.ts` — `azureAdapter({ apiKey?, region?, fetch?, pricePer1kChars? })` with `tts(req: TtsRequest)`. Endpoint `https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`; headers `Ocp-Apim-Subscription-Key`, `Content-Type: application/ssml+xml`, `X-Microsoft-OutputFormat`; SSML body `<speak version='1.0' xml:lang='{lang}'><voice name='{voice}'>{escaped text}</voice></speak>`. Returns `{ audio, mimeType:"audio/mpeg", usage }`.
- **Curated da-DK voices**: `AZURE_DANISH_VOICES` (`christel`→`da-DK-ChristelNeural`, `jeppe`→`da-DK-JeppeNeural`) + a `resolveAzureVoice()` (friendly name → full voice; raw voice name passes through). These friendly names do NOT collide with `ELEVENLABS_DANISH_VOICES` (soren/jesper/mads/noam/camilla), so the client's existing `resolveVoice` passes them through to the Azure adapter unchanged.
- **Additive schema**: optional `lang?` + `format?` on `ttsInputSchema` (`src/schema/inputs.ts`) and `TtsRequest` (`src/types.ts`) — ElevenLabs ignores them; Azure uses them (lang defaults to the voice's locale, e.g. `da-DK-ChristelNeural`→`da-DK`; format defaults to `audio-24khz-48kbitrate-mono-mp3`).
- Register `azure: azureAdapter()` in `src/providers/registry.ts`; export `azureAdapter`, `AZURE_DANISH_VOICES`, `resolveAzureVoice` from `src/index.ts`.
- Pricing: `AZURE_TTS_PRICE_PER_1K_CHARS` (≈ Azure neural standard $16/1M = $0.016/1k — **verify on the Azure pricing page**), overridable via `config.pricePer1kChars` (mirrors the ElevenLabs adapter).
- `src/providers/azure.test.ts` — mocked-fetch: SSML body + headers + region URL, MP3 out, char→cost, ship-dark (no key → throws), and `ai.tts({ override:{provider:"azure"} })` end-to-end routing.
- `docs/API.md` — note the Azure EU-Danish route under TTS.

### Out of scope
- **Changing `DEFAULT_TTS_SPEC`** — ElevenLabs stays the default; Azure is opt-in via `override` (surgical, no behavior change for existing callers).
- **SSML prosody / styles / multi-voice** — plain single-voice narration only (cardmem's need). Dialogue/podcast stays ElevenLabs.
- **Azure account/key provisioning** — Christian creates the Speech resource (West Europe) + key; the SDK just consumes `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` from env (ship-dark until set).
- **Auto EU-routing of TTS for personal data** — plan-readaloud is not personal data; no hard GDPR gate. (Voice of a person ≠ personal data of a third party here.)

## Architecture

### `azureAdapter` (`src/providers/azure.ts`)
```ts
export const AZURE_DANISH_VOICES: Record<string,string> = {
  christel: "da-DK-ChristelNeural", jeppe: "da-DK-JeppeNeural",
};
export function resolveAzureVoice(nameOrVoice: string): string { /* friendly → full; else passthrough */ }
export function azureAdapter(config?: { apiKey?: string; region?: string; fetch?: typeof fetch; pricePer1kChars?: number }): ProviderAdapter;
// tts(req): POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
//   headers: Ocp-Apim-Subscription-Key, Content-Type: application/ssml+xml, X-Microsoft-OutputFormat
//   body: SSML(speak xml:lang=<lang from req.lang|voice-locale>, voice name=<resolved>, text=<xml-escaped>)
//   → { audio: Uint8Array, mimeType: "audio/mpeg", usage: priceFor(req.text.length) }
//   key()/region() throw a clear error if unset (ship-dark). region default "westeurope".
```
Auth: `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` env (or config). Region-pinned EU host. XML-escape the text (`& < > " '`) to keep SSML valid.

## Stories
- **F026.1** — `azureAdapter.tts` + curated da-DK voices + registry/export + mocked-fetch tests.
- **F026.2** — additive `lang?`/`format?` on `ttsInputSchema` + `TtsRequest`; `docs/API.md` Azure-TTS note.
- **F026.3** — live smoke once Christian's `AZURE_SPEECH_KEY` is set (one da-DK clip), then release + ping cardmem with the version.

## Acceptance criteria
1. `ai.tts({ text:"Hej fra planen", voice:"christel", override:{ provider:"azure", model:"neural" } })` builds the right SSML (`<voice name="da-DK-ChristelNeural">`), POSTs to `https://westeurope.tts.speech.microsoft.com/...` with `Ocp-Apim-Subscription-Key`, and returns MP3 bytes — verified by a mocked-fetch test.
2. Cost: `usage.capability==="tts"`, `usage.provider==="azure"`, `usage.costUsd === (chars/1000)*rate` — asserted in test; lands in the cost-sink pipeline like any call.
3. Ship-dark: with no key, the adapter throws a clear `AZURE_SPEECH_KEY`-not-set error only when called (no import-time crash); test covers it.
4. Text is XML-escaped in the SSML (a `&`/`<` in the plan text doesn't break the request); test covers it.
5. Existing ElevenLabs `ai.tts` path + full suite stay green.
6. Live smoke produces an audible da-DK MP3 once the key is set (F026.3); then published + cardmem pinged.

## Dependencies
- Existing `ai.tts` capability (F020.4) + `ProviderAdapter.tts`. None blocking.
- Christian provisions the Azure Speech resource (West Europe) + key (the only human-gated step).
- Consumer: cardmem F160 builds endpoint + R2-hash-cache against the locked `ai.tts` signature.

## Rollout
Additive, ship-dark. New opt-in provider; no change to defaults or existing callers. Rollback = drop the registry entry. Live use waits on `AZURE_SPEECH_KEY` being set (F026.3).

## Open Questions
None blocking. (Default-provider for `ai.tts` stays ElevenLabs; revisit only if Azure becomes the fleet default.)

## Effort estimate
**S–M** — ~half a day for the adapter + tests; F026.3 is a 5-minute live smoke once the key lands.
