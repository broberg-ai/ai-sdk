// ElevenLabs adapter (F020). Text-to-Dialogue (eleven_v3) turns a manuscript of
// {text, voice_id} turns into ONE cohesive multi-voice audio episode — the
// "instant podcast" primitive. Also single-voice TTS + voice listing. Audio out
// is MP3 bytes; billed per character. Key from ELEVENLABS_API_KEY.
import { freshUsage } from "../cost/usage.js";
import type { ProviderAdapter, DialogueRequest, PodcastResult } from "../types.js";

/** USD per 1000 characters (ElevenLabs bills per char; API overage ≈ $0.10–0.18/1k). */
const ELEVENLABS_PRICE_PER_1K_CHARS = 0.15;

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  language?: string;
}

export function elevenlabsAdapter(
  config: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch; pricePer1kChars?: number } = {},
): ProviderAdapter & {
  listVoices(): Promise<ElevenLabsVoice[]>;
  tts(req: { text: string; voiceId: string; model?: string }): Promise<PodcastResult>;
} {
  const baseUrl = config.baseUrl ?? "https://api.elevenlabs.io/v1";
  const fetchImpl = config.fetch ?? fetch;

  function key(): string {
    const k = config.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!k) throw new Error("elevenlabs adapter: API key not set (env ELEVENLABS_API_KEY)");
    return k;
  }

  function priceFor(chars: number, model: string): ReturnType<typeof freshUsage> {
    const usage = freshUsage({
      provider: "elevenlabs",
      model,
      transport: "http",
      capability: "podcast",
      inputTokens: 0,
      outputTokens: 0,
    });
    usage.costUsd = (chars / 1000) * (config.pricePer1kChars ?? ELEVENLABS_PRICE_PER_1K_CHARS);
    return usage;
  }

  // Multi-voice dialogue → one episode. POST /text-to-dialogue.
  async function dialogue(req: DialogueRequest): Promise<PodcastResult> {
    const res = await fetchImpl(`${baseUrl}/text-to-dialogue`, {
      method: "POST",
      headers: { "xi-api-key": key(), "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        model_id: req.spec.model,
        inputs: req.inputs.map((t) => ({ text: t.text, voice_id: t.voiceId })),
        ...(req.format ? { output_format: req.format } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`elevenlabs dialogue ${res.status}: ${body.slice(0, 300)}`);
    }
    const audio = new Uint8Array(await res.arrayBuffer());
    const chars = req.inputs.reduce((n, t) => n + t.text.length, 0);
    return { audio, mimeType: "audio/mpeg", usage: priceFor(chars, req.spec.model) };
  }

  // Single-voice TTS. POST /text-to-speech/{voice_id}.
  async function tts(req: { text: string; voiceId: string; model?: string }): Promise<PodcastResult> {
    const model = req.model ?? "eleven_multilingual_v2";
    const res = await fetchImpl(`${baseUrl}/text-to-speech/${req.voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": key(), "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: req.text, model_id: model }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`elevenlabs tts ${res.status}: ${body.slice(0, 300)}`);
    }
    const audio = new Uint8Array(await res.arrayBuffer());
    return { audio, mimeType: "audio/mpeg", usage: priceFor(req.text.length, model) };
  }

  async function listVoices(): Promise<ElevenLabsVoice[]> {
    const res = await fetchImpl(`${baseUrl}/voices`, { headers: { "xi-api-key": key() } });
    if (!res.ok) throw new Error(`elevenlabs voices ${res.status}`);
    const data = (await res.json()) as { voices?: { voice_id: string; name: string; labels?: { language?: string } }[] };
    return (data.voices ?? []).map((v) => ({ voiceId: v.voice_id, name: v.name, language: v.labels?.language }));
  }

  return { name: "elevenlabs", dialogue, tts, listVoices };
}
