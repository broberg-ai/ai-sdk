// Transcribe capability. No tier in the tier map (provider-specific, like image)
// — defaults to OpenAI Whisper, overridable per call. Synergy: cctalk Danish
// dictation. costUsd is 0 for v1 (Whisper is priced per minute, not per token).
import type { TierSpec } from "../types.js";

export const DEFAULT_TRANSCRIBE_SPEC: TierSpec = {
  provider: "openai",
  model: "whisper-1",
  transport: "http",
};

/** Fetch a URL to raw bytes; pass through bytes unchanged. */
export async function resolveAudio(
  audio: string | Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  if (typeof audio !== "string") return audio;
  if (!/^https?:\/\//.test(audio)) {
    throw new Error("transcribe: string audio must be an http(s) URL (or pass raw bytes)");
  }
  const res = await fetchImpl(audio);
  if (!res.ok) throw new Error(`transcribe: failed to fetch audio (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
