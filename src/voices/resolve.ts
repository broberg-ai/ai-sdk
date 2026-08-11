// F037 — the synchronous, zero-I/O voice resolve + roster read, mirroring
// src/availability/resolve.ts (F022) so a consumer learns ONE idiom for models and
// voices. Never awaits, never touches the network: this sits on the TTS call path.
import { allVoices, getVoice } from "./registry.js";
import { VoiceUnavailableError } from "./types.js";
import type { VoiceInfo, VoiceProvider, VoiceResolveResult } from "./types.js";

export interface CheckVoiceOptions {
  /** One name/id or an ordered chain to try when `requested` is retired. */
  fallback?: string | string[];
  /** Throw VoiceUnavailableError instead of returning ok:false when nothing in the
   *  chain is usable. For callers that want to fail loudly rather than degrade. */
  throwIfUnavailable?: boolean;
}

/**
 * The shared voice read — a UI picker greys out `available:false` rows and can show
 * `checkedAt` so a stale registry is visible rather than silently trusted.
 *
 * NB: distinct from `elevenlabsAdapter().listVoices()`, which is an async call to
 * ElevenLabs' live API. This one is synchronous, cross-provider, and reads only the
 * curated registry.
 */
export function listVoices(opts: { provider?: VoiceProvider } = {}): VoiceInfo[] {
  return allVoices(opts.provider);
}

/** Usable? Untracked voices are fail-open — we never block a raw provider voice id
 *  just because it is not on our curated roster. */
function usable(nameOrId: string): boolean {
  const v = getVoice(nameOrId);
  return v ? v.available : true;
}

/** The id to actually send for a name/id: the registry's full id when we know it,
 *  otherwise the input verbatim (a raw provider voice id). */
function idFor(nameOrId: string): string {
  return getVoice(nameOrId)?.id ?? nameOrId;
}

/**
 * Resolve a requested voice (curated name or raw provider id) to one that is
 * actually usable. Synchronous + offline by contract.
 *
 * - Available → pass through ({ ok:true, fellBack:false }).
 * - Retired + a usable fallback → swap ({ ok:false, fellBack:true }).
 * - Retired + no usable fallback → throw (throwIfUnavailable) or return ok:false.
 * - Untracked id → treated usable ({ status:"unknown" }), passed through verbatim.
 */
export function checkVoice(requested: string, opts: CheckVoiceOptions = {}): VoiceResolveResult {
  const entry = getVoice(requested);
  const provider = entry?.provider;

  if (usable(requested)) {
    return {
      ok: true,
      voiceId: idFor(requested),
      requested,
      provider,
      fellBack: false,
      status: entry?.status ?? "unknown",
    };
  }

  // Requested is retired — walk the fallback chain for the first usable one.
  const chain = opts.fallback === undefined ? [] : Array.isArray(opts.fallback) ? opts.fallback : [opts.fallback];
  for (const fb of chain) {
    if (usable(fb)) {
      return {
        ok: false,
        voiceId: idFor(fb),
        requested,
        provider: getVoice(fb)?.provider ?? provider,
        fellBack: true,
        status: entry?.status ?? "retired",
        reason: entry?.note ?? `${requested} is unavailable`,
      };
    }
  }

  if (opts.throwIfUnavailable) {
    throw new VoiceUnavailableError(requested, entry?.note, provider);
  }
  return {
    ok: false,
    voiceId: idFor(requested),
    requested,
    provider,
    fellBack: false,
    status: entry?.status ?? "retired",
    reason: entry?.note ?? `${requested} is unavailable`,
  };
}
