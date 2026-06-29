# F029 — Azure Speech-to-Text (`transcribe`) on `azureAdapter` (EU da-DK)

> Tier: capability/provider. Effort: S–M. Status: building. Consumer: cardmem F185 (customer-interview transcription).

## Motivation

cardmem F185 transcribes **customer-interview recordings** — personal data, so EU/GDPR is a hard requirement. Today the SDK's only EU STT is **Voxtral (Mistral)**, and it **cannot force Danish**: `ai.transcribe({ language:'da' })` → 400 `unsupported language 'da'` (Voxtral only accepts ar/en/de/es/fr/hi/it/nl/pt/zh/ru/ko/ja). It works via auto-detect but quality isn't guaranteed. OpenAI Whisper does Danish but is US-hosted → out on GDPR. **Azure Speech runs in the EU (Sweden Central / West Europe / North Europe) AND officially supports `da-DK`.** Our `azureAdapter` already does TTS — STT is an *extension*, not a new adapter. Christian initiated the request ("smid opgaven over til ai-sdk for at få Azure STT med, Azure kører i EU").

## Solution

Add `transcribe(req: TranscribeRequest)` to `azureAdapter` using Azure's **fast transcription** REST API (synchronous, `da-DK` locale), reusing the existing `AZURE_SPEECH_KEY` + region. Cost is per-minute from the response's real `durationMilliseconds`. Returns `{ text, usage }`. Ship-dark. The fleet then has **two EU STT** to pick between (Voxtral + Azure) per project.

## Scope

### In scope
- `transcribe()` on `azureAdapter` (`src/providers/azure.ts`) → `return { name:"azure", tts, transcribe }`.
  - Endpoint (fast transcription): `POST https://{host}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`, headers `Ocp-Apim-Subscription-Key`. Body `multipart/form-data`: `audio` (bytes as Blob) + `definition` (JSON `{"locales":["da-DK"]}`).
  - **Host (live-verify):** Azure STT uses a DIFFERENT host than TTS (`{region}.tts.speech.microsoft.com`). Fast transcription is `{region}.api.cognitive.microsoft.com` OR the resource custom domain `{resource}.cognitiveservices.azure.com` — **which one works depends on the resource's subdomain config**, so the live smoke confirms it (default region host; add `AZURE_SPEECH_RESOURCE`/`sttBaseUrl` override if the custom domain is required).
  - Parse `combinedPhrases[0].text` → `text`. Cost = `(durationMilliseconds/60000) × rate`, falling back to `req.durationSec` if the response omits it.
  - Locale map: `da`→`da-DK`, `en`→`en-US`, … (full locales like `da-DK` pass through). Default `da-DK` when `language` omitted (the EU-Danish use-case), or auto-detect.
- `AZURE_STT_PRICE_PER_MIN` constant (≈ Azure fast/batch transcription rate — **verify on the Azure pricing page**), overridable via `config.sttPricePerMin` (mirrors the TTS `pricePer1kChars`).
- `src/providers/azure.test.ts` — mocked-fetch: multipart `definition` carries `da-DK`, auth header, `combinedPhrases[0].text` parsed, cost from `durationMilliseconds`, ship-dark throw.
- **Live verification:** transcribe one of the F026 Danish TTS MP3s (a known Danish sentence) → assert the da-DK transcript comes back, real cost logged. (TTS→STT round-trip = self-contained proof.)
- `docs/API.md` — note Azure as the 2nd EU STT (da-DK forced) next to Voxtral.

### Out of scope
- **Diarization / multi-speaker / word-timestamps** — `combinedPhrases[0].text` only (cardmem wants the transcript). The API supports diarization; not wired now.
- **Batch transcription (async, large files)** — fast transcription (synchronous, ≤ a few hundred MB) covers interviews; batch is a later story if needed.
- **Changing `DEFAULT_TRANSCRIBE_SPEC`** — Azure is opt-in via `override:{provider:"azure"}`; default unchanged.

## Architecture

### `transcribe` (in `azureAdapter`)
```ts
async function transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
  const locale = toAzureLocale(req.language);            // "da" → "da-DK"; "da-DK" passthrough; default da-DK
  const form = new FormData();
  form.append("audio", new Blob([req.audio]), "audio");
  form.append("definition", JSON.stringify({ locales: [locale] }));
  // POST {sttHost}/speechtotext/transcriptions:transcribe?api-version=… , Ocp-Apim-Subscription-Key
  // → { combinedPhrases:[{text}], durationMilliseconds }
  // text = combinedPhrases[0].text; cost = (durationMs/60000)*rate (else req.durationSec)
  // usage: provider:"azure", capability:"transcribe", costUsd
}
```
Reuses `AZURE_SPEECH_KEY`; region via `AZURE_SPEECH_REGION` (default westeurope; ours = swedencentral).

## Stories
- **F029.1** — `transcribe()` on azureAdapter + locale map + per-minute pricing + mocked-fetch tests.
- **F029.2** — live da-DK verification (TTS→STT round-trip) + resolve the host (region vs custom-domain) + `docs/API.md` note; release + ping cardmem with the F-number + the verified transcript.

## Acceptance criteria
1. `ai.transcribe({ audio, language:'da', override:{provider:'azure', model:'<default>'} })` sends `definition` with `locales:["da-DK"]` + `Ocp-Apim-Subscription-Key`, parses `combinedPhrases[0].text` — mocked-fetch test.
2. Cost: `usage.capability==='transcribe'`, `usage.provider==='azure'`, `costUsd === (durationMs/60000)*rate` — asserted; lands in the cost-sink.
3. Ship-dark: no key → clear throw only when called; full suite + typecheck green.
4. **Live:** a real Danish audio clip transcribes to correct da-DK text via the actual Azure endpoint (host confirmed), real cost logged.

## Dependencies
- Existing `ai.transcribe` capability + `TranscribeRequest`/`Result` + `ProviderAdapter.transcribe?` (Voxtral pattern). None blocking.
- `AZURE_SPEECH_KEY` (already set for TTS). Live test uses an F026 da-DK MP3.

## Rollout
Additive, ship-dark. New capability on an existing adapter; no default change. Rollback = remove `transcribe` from the azure return. cardmem wires `override:{provider:'azure'}` next to their Voxtral override → Christian picks per project.

## Open Questions
- **STT host:** region host (`{region}.api.cognitive.microsoft.com`) vs resource custom domain (`{resource}.cognitiveservices.azure.com`) — resolved by the live smoke; may add `AZURE_SPEECH_RESOURCE` env if the custom domain is mandatory.
- **Exact `api-version`** (2024-11-15 GA vs 2025-10-15) + **exact price/min** — both confirmed during live verification.

## Effort estimate
**S–M** — ~half a day incl. the live host-resolution + da-DK verification.
