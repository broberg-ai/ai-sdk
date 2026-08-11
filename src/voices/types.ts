// F037 — voice availability. Mirrors src/availability/ (models) for VOICES, and
// exists for a reason the model side does not have.
//
// `resolveVoice()` has only TWO states: a curated name maps to an id, or the input
// is passed through verbatim as a raw provider voice id. There is no way to say
// "we know this voice, and it is gone". So when a provider retires a voice, the
// obvious fix — delete it from the curated map — makes the call fail MORE
// confusingly: the literal friendly name ("mads") gets POSTed as a voice id.
//
// That missing third state is what this module adds. It is not primarily a
// drift-detector; it is the only way to act on a retirement at all.

export type VoiceStatus = "available" | "retired" | "unknown";

export type VoiceProvider = "elevenlabs" | "azure";

/** One row of the shared voice read — what a UI voice-picker renders. */
export interface VoiceInfo {
  /** Full provider voice id, e.g. "da-DK-ChristelNeural" / "4RklGmuxoAskAbGXplXN". */
  id: string;
  /** Curated friendly name a caller passes as `voice`, e.g. "christel". */
  name: string;
  provider: VoiceProvider;
  /** BCP-47 locale of the voice itself, e.g. "da-DK". NB: an Azure multilingual
   *  voice speaking Danish reports its own locale ("de-DE" for Seraphina) — that
   *  is what the adapter actually sends as xml:lang. */
  locale: string;
  /** Only where the provider publishes it — absent is "we do not know", never a
   *  guess from the first name. */
  gender?: "female" | "male";
  available: boolean;
  status: VoiceStatus;
  /** Why it is unavailable, or any caveat worth showing in a picker. */
  note?: string;
  /** ISO date this row's status was last confirmed AGAINST THE PROVIDER. Exposed
   *  on purpose (the F034.1 lesson): a registry that cannot be seen to go stale
   *  is worse than one that can, because nobody knows when to re-check it. */
  checkedAt: string;
}

/** Result of checkVoice — deliberately the same shape as ResolveResult (F022) so
 *  a consumer learns one idiom for models and voices. */
export interface VoiceResolveResult {
  /** True when the requested voice itself is usable. */
  ok: boolean;
  /** The id to actually send: the requested voice's id when ok, else the
   *  fallback's. When there is no usable fallback this is the dead id and `ok`
   *  is false — mirroring resolveModel, the caller must read `ok`. */
  voiceId: string;
  /** What the caller asked for, verbatim. */
  requested: string;
  provider?: VoiceProvider;
  /** True when `voiceId` differs from what was requested because we fell back. */
  fellBack: boolean;
  status: VoiceStatus;
  /** Why it degraded / why it is unavailable. */
  reason?: string;
}

/** Thrown when the requested voice is retired and no usable fallback exists.
 *  Callers flag on `.code === "voice_unavailable"`. */
export class VoiceUnavailableError extends Error {
  readonly code = "voice_unavailable";
  readonly requested: string;
  readonly provider?: VoiceProvider;
  readonly note?: string;
  constructor(requested: string, note?: string, provider?: VoiceProvider) {
    super(`voice "${requested}" is unavailable${note ? ` (${note})` : ""}`);
    this.name = "VoiceUnavailableError";
    this.requested = requested;
    this.note = note;
    this.provider = provider;
  }
}
