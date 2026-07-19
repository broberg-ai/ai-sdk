// Azure Speech (Cognitive Services) TTS adapter (F026). Natural EU-resident
// neural Danish read-aloud behind the existing `ai.tts` capability. Azure Speech
// is NOT reachable via OpenRouter (that proxies LLM chat/completions only) — this
// is a direct SSML REST call, region-pinned to an EU host. Audio out is MP3 bytes;
// billed per character. Key + region from AZURE_SPEECH_KEY / AZURE_SPEECH_REGION.
import { freshUsage } from "../cost/usage.js";
import type { ProviderAdapter, TtsRequest, PodcastResult, TranscribeRequest, TranscribeResult } from "../types.js";

/** USD per 1000 characters. ≈ Azure neural standard ($16 / 1M chars) — verify on
 *  azure.microsoft.com/pricing; override via config.pricePer1kChars. */
const AZURE_TTS_PRICE_PER_1K_CHARS = 0.016;

/** USD per audio-minute for speech-to-text. ≈ Azure standard STT ($1 / audio-hour
 *  = $0.0167/min) — verify the fast-transcription rate on azure.microsoft.com/pricing;
 *  override via config.sttPricePerMin. */
const AZURE_STT_PRICE_PER_MIN = 0.0167;

/** Fast-transcription REST api-version. 2025-10-15 is required for the `phraseList`
 *  biasing field (2024-11-15 rejects it as "Invalid JSON"); both serve plain
 *  transcription. Override via config.sttApiVersion. (Live-verified F029.) */
const DEFAULT_STT_API_VERSION = "2025-10-15";

/** Default region — EU/GDPR-clean. Override via config.region / AZURE_SPEECH_REGION. */
const DEFAULT_REGION = "westeurope";

/** Default MP3 output (Azure's X-Microsoft-OutputFormat). */
const DEFAULT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

/** Short language code → Azure STT locale. A full locale ("da-DK") passes through;
 *  omitted language defaults to da-DK (the EU-Danish use-case this was built for). */
const AZURE_LOCALE_MAP: Record<string, string> = {
  da: "da-DK", en: "en-US", de: "de-DE", sv: "sv-SE", nb: "nb-NO", no: "nb-NO",
  fi: "fi-FI", nl: "nl-NL", fr: "fr-FR", es: "es-ES", it: "it-IT", pt: "pt-PT",
};
function toAzureLocale(lang?: string): string {
  if (!lang) return "da-DK";
  if (lang.includes("-")) return lang;
  return AZURE_LOCALE_MAP[lang.toLowerCase()] ?? lang;
}

/** A curated Danish-speaking Azure voice, exposed so a consuming app can render a
 *  picker. `native` = a true da-DK voice (most natural); otherwise a multilingual
 *  voice that also speaks Danish (Azure has only 2 native da-DK voices). */
export interface AzureVoiceInfo {
  /** Friendly name a caller passes as `voice` (e.g. "christel"). */
  name: string;
  /** Full Azure voice name (e.g. "da-DK-ChristelNeural"). */
  voiceId: string;
  gender: "female" | "male";
  /** Display label for a UI picker. */
  display: string;
  /** True for the 2 native da-DK voices; false for multilingual voices speaking Danish. */
  native: boolean;
  /** Per-voice default speaking rate, applied when a call passes no explicit `rate`
   *  (e.g. Christel reads a touch fast, so her natural default is 0.85). Omitted = 1 (normal). */
  defaultRate?: number;
}

/** Curated da-DK roster (F026) — 2 native + 4 multilingual, 3 of each gender.
 *  Verified against Azure's voices/list (only Christel + Jeppe are native da-DK). */
export const AZURE_DANISH_VOICE_LIST: AzureVoiceInfo[] = [
  { name: "christel", voiceId: "da-DK-ChristelNeural", gender: "female", display: "Christel", native: true, defaultRate: 0.85 },
  { name: "seraphina", voiceId: "de-DE-SeraphinaMultilingualNeural", gender: "female", display: "Seraphina", native: false },
  { name: "ava", voiceId: "en-US-AvaMultilingualNeural", gender: "female", display: "Ava", native: false },
  { name: "jeppe", voiceId: "da-DK-JeppeNeural", gender: "male", display: "Jeppe", native: true },
  { name: "florian", voiceId: "de-DE-FlorianMultilingualNeural", gender: "male", display: "Florian", native: false },
  { name: "andrew", voiceId: "en-US-AndrewMultilingualNeural", gender: "male", display: "Andrew", native: false },
];

/** Friendly name → full Azure voice name. Distinct from ELEVENLABS_DANISH_VOICES so
 *  the client's resolveVoice passes these through unchanged to this adapter. */
export const AZURE_DANISH_VOICES: Record<string, string> = Object.fromEntries(
  AZURE_DANISH_VOICE_LIST.map((v) => [v.name, v.voiceId]),
);

/** The curated Danish voice roster, for a consuming app to present in a picker. */
export function listAzureDanishVoices(): AzureVoiceInfo[] {
  return AZURE_DANISH_VOICE_LIST;
}

/** Resolve a curated friendly name to its full Azure voice; pass a full voice name
 *  (e.g. "da-DK-ChristelNeural") through unchanged. */
export function resolveAzureVoice(nameOrVoice: string): string {
  return AZURE_DANISH_VOICES[nameOrVoice] ?? nameOrVoice;
}

/** XML-escape so a `&`/`<` in the text can't break the SSML envelope. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Derive the BCP-47 locale from a voice name: "da-DK-ChristelNeural" → "da-DK". */
function localeOf(voice: string): string {
  const parts = voice.split("-");
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : "en-US";
}

export function azureAdapter(
  config: {
    apiKey?: string;
    region?: string;
    fetch?: typeof fetch;
    pricePer1kChars?: number;
    /** USD per audio-minute for transcribe (overrides AZURE_STT_PRICE_PER_MIN). */
    sttPricePerMin?: number;
    /** STT base URL override (e.g. a resource custom domain). */
    sttBaseUrl?: string;
    /** Resource name → custom-domain STT host `{resource}.cognitiveservices.azure.com`
     *  (or env AZURE_SPEECH_RESOURCE). Without it, STT uses the regional host. */
    resource?: string;
    /** Fast-transcription api-version (overrides the GA default). */
    sttApiVersion?: string;
    /** phraseList biasing weight (0–2) applied when a call passes `phrases`. Default 1.5. */
    sttBiasingWeight?: number;
  } = {},
): ProviderAdapter {
  const fetchImpl = config.fetch ?? fetch;

  function key(): string {
    const k = config.apiKey ?? process.env.AZURE_SPEECH_KEY;
    if (!k) throw new Error("azure adapter: API key not set (env AZURE_SPEECH_KEY)");
    return k;
  }
  function region(): string {
    return config.region ?? process.env.AZURE_SPEECH_REGION ?? DEFAULT_REGION;
  }
  /** STT host. Default = regional cognitive host; a resource name (config/env) →
   *  the custom-domain host (some resources require it). Live-verified per resource. */
  function sttBaseUrl(): string {
    if (config.sttBaseUrl) return config.sttBaseUrl.replace(/\/$/, "");
    const resource = config.resource ?? process.env.AZURE_SPEECH_RESOURCE;
    if (resource) return `https://${resource}.cognitiveservices.azure.com`;
    return `https://${region()}.api.cognitive.microsoft.com`;
  }

  function priceFor(chars: number, model: string): ReturnType<typeof freshUsage> {
    const usage = freshUsage({
      provider: "azure",
      model,
      transport: "http",
      capability: "tts",
      inputTokens: 0,
      outputTokens: 0,
    });
    usage.costUsd = (chars / 1000) * (config.pricePer1kChars ?? AZURE_TTS_PRICE_PER_1K_CHARS);
    return usage;
  }

  // Single-voice TTS. POST .../cognitiveservices/v1 with an SSML body.
  async function tts(req: TtsRequest): Promise<PodcastResult> {
    const voice = resolveAzureVoice(req.voiceId);
    const lang = req.lang ?? localeOf(voice);
    const format = req.format ?? DEFAULT_FORMAT;
    // Speaking rate via SSML <prosody>: a multiplier of the default (1 = normal,
    // 0.9 = 10% slower, 1.1 = 10% faster). An explicit req.rate wins; otherwise the
    // voice's own defaultRate (e.g. Christel = 0.85) applies; else no wrapper.
    const escaped = xmlEscape(req.text);
    const effRate = req.rate ?? AZURE_DANISH_VOICE_LIST.find((v) => v.voiceId === voice)?.defaultRate;
    const inner =
      effRate != null && effRate !== 1 ? `<prosody rate='${effRate}'>${escaped}</prosody>` : escaped;
    const ssml =
      `<speak version='1.0' xml:lang='${lang}'>` +
      `<voice name='${voice}'>${inner}</voice></speak>`;
    const res = await fetchImpl(
      `https://${region()}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key(),
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": format,
        },
        body: ssml,
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`azure tts ${res.status}: ${body.slice(0, 300)}`);
    }
    const audio = new Uint8Array(await res.arrayBuffer());
    return { audio, mimeType: "audio/mpeg", usage: priceFor(req.text.length, req.spec.model) };
  }

  // Speech-to-text (F029) via Azure fast transcription. Synchronous multipart POST
  // → { combinedPhrases:[{text}], durationMilliseconds }. da-DK forced (Voxtral can't).
  // Cost is per audio-minute from the response's real duration. EU-resident.
  async function transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    const locale = toAzureLocale(req.language);
    const definition: Record<string, unknown> = { locales: [locale] };
    // Bias toward known brand/jargon terms (F029.3) — lifts accuracy on names the
    // model wouldn't otherwise know (e.g. "cardmem", "Pins"). Other STTs ignore phrases.
    if (req.phrases && req.phrases.length > 0) {
      definition.phraseList = { phrases: req.phrases, biasingWeight: config.sttBiasingWeight ?? 1.5 };
    }
    const form = new FormData();
    form.append("audio", new Blob([req.audio]), "audio");
    form.append("definition", JSON.stringify(definition));
    const url = `${sttBaseUrl()}/speechtotext/transcriptions:transcribe?api-version=${config.sttApiVersion ?? DEFAULT_STT_API_VERSION}`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key() },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`azure transcribe ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      combinedPhrases?: { text?: string }[];
      durationMilliseconds?: number;
      // Fast-transcription phrases carry ms offsets + per-word timing (F036.1).
      phrases?: {
        text?: string;
        offsetMilliseconds?: number;
        durationMilliseconds?: number;
        words?: { text?: string; offsetMilliseconds?: number; durationMilliseconds?: number }[];
      }[];
    };
    const text = data.combinedPhrases?.[0]?.text ?? "";
    // Prefer the API's real duration; fall back to a caller-supplied durationSec.
    const minutes =
      data.durationMilliseconds != null
        ? data.durationMilliseconds / 60000
        : (req.durationSec ?? 0) / 60;
    const usage = freshUsage({
      provider: "azure",
      model: req.spec.model,
      transport: "http",
      capability: "transcribe",
      inputTokens: 0,
      outputTokens: 0,
    });
    usage.costUsd = minutes * (config.sttPricePerMin ?? AZURE_STT_PRICE_PER_MIN);
    const result: TranscribeResult = { text, usage };
    // Timestamps (F036.1) — Azure fast-transcription already returns phrases+words
    // with ms offsets; surface them on the same TranscribeResult shape as Whisper.
    // "word" granularity → words[]; any timestamps request → segments[].
    if (req.timestamps && req.timestamps.length > 0 && data.phrases) {
      const toSec = (ms?: number) => (ms ?? 0) / 1000;
      if (req.timestamps.includes("word")) {
        const words = data.phrases.flatMap((p) => p.words ?? []);
        if (words.length > 0) {
          result.words = words.map((w) => ({
            word: w.text ?? "",
            start: toSec(w.offsetMilliseconds),
            end: toSec((w.offsetMilliseconds ?? 0) + (w.durationMilliseconds ?? 0)),
          }));
        }
      }
      result.segments = data.phrases.map((p) => ({
        text: p.text ?? "",
        start: toSec(p.offsetMilliseconds),
        end: toSec((p.offsetMilliseconds ?? 0) + (p.durationMilliseconds ?? 0)),
      }));
    }
    return result;
  }

  return { name: "azure", tts, transcribe };
}
