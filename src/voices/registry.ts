// F037 — the voice registry. DERIVED from the curated rosters, never a second copy
// of them: ELEVENLABS_DANISH_VOICES and AZURE_DANISH_VOICE_LIST stay the single
// source for which voices we bless, and this module only adds the status layer on
// top. A copied roster is a roster that drifts.
import { ELEVENLABS_DANISH_VOICES } from "../providers/elevenlabs.js";
import { AZURE_DANISH_VOICE_LIST, localeOf } from "../providers/azure.js";
import type { VoiceInfo, VoiceProvider } from "./types.js";

/** When each provider's roster was last confirmed against the provider itself.
 *  These are MEASUREMENTS with dates, not a claim of current truth — that is the
 *  whole point of surfacing checkedAt. */
const CHECKED_AT: Record<VoiceProvider, string> = {
  // All 5 curated ids confirmed by SYNTHESIS — POST /v1/text-to-speech/{id} returned
  // 200 with distinct audio per voice (5 distinct sha256), and a fabricated id
  // returned 404, so a 200 means something.
  //
  // NB: GET /v1/voices/{id} is NOT a liveness test and must not be used as one. It
  // answers "is this voice saved in our account", and returns voice_not_found for a
  // public/shared voice that synthesizes perfectly well. Using it cost us a false
  // retirement (see the note on `mads` below) — the only honest liveness check for
  // ElevenLabs is a real synthesis call, which is exactly why v1 does no live check.
  elevenlabs: "2026-08-11",
  // F026 (6ca38c4) verified the 6 curated names against Azure's voices/list. Not
  // re-probed since: this machine has no Azure Speech key, and inventing a fresher
  // date than the last real check is exactly the lie checkedAt exists to prevent.
  azure: "2026-06-23",
};

/** Voices we know are GONE — keyed by curated name. A row here is the third state
 *  the old two-state resolveVoice could not express. Keep the entry: deleting it
 *  would send the friendly name to the provider as a raw voice id.
 *
 *  Currently EMPTY. Every curated voice was synthesis-verified on 2026-08-11. This
 *  map existing while empty is the point — it is the mechanism that lets us act on
 *  a retirement the day one happens, instead of discovering we cannot express it. */
const RETIRED_DEFAULT: Record<string, string> = {};

let RETIRED: Record<string, string> = RETIRED_DEFAULT;

/** Genders as published by the provider's voices endpoint. Absent = we have no
 *  source; never inferred from a first name. `mads` is absent because it is not
 *  saved to our account, and that endpoint only describes account voices — the
 *  voice itself works fine. */
const ELEVENLABS_GENDER: Record<string, "female" | "male"> = {
  soren: "male",
  jesper: "male",
  noam: "male",
  camilla: "female",
};

/** Caveats worth showing in a picker that are NOT unavailability. */
const NOTES: Record<string, string> = {
  mads: "usable, but not saved to the ElevenLabs account, so the voices endpoint publishes no metadata for it (verified by synthesis 2026-08-11)",
};

function build(): VoiceInfo[] {
  const rows: VoiceInfo[] = [];

  for (const [name, id] of Object.entries(ELEVENLABS_DANISH_VOICES)) {
    const retired = RETIRED[name];
    rows.push({
      id,
      name,
      provider: "elevenlabs",
      // The curated ElevenLabs roster IS the Danish one (see the constant's name
      // + F020); the multilingual model speaks it as da-DK.
      locale: "da-DK",
      gender: ELEVENLABS_GENDER[name],
      available: retired === undefined,
      status: retired === undefined ? "available" : "retired",
      note: retired ?? NOTES[name],
      checkedAt: CHECKED_AT.elevenlabs,
    });
  }

  for (const v of AZURE_DANISH_VOICE_LIST) {
    const retired = RETIRED[v.name];
    rows.push({
      id: v.voiceId,
      name: v.name,
      provider: "azure",
      locale: localeOf(v.voiceId),
      gender: v.gender,
      available: retired === undefined,
      status: retired === undefined ? "available" : "retired",
      note: retired ?? NOTES[v.name],
      checkedAt: CHECKED_AT.azure,
    });
  }

  return rows;
}

let ROWS: VoiceInfo[] = build();

/** All curated voices, current status applied. Optionally scoped to one provider. */
export function allVoices(provider?: VoiceProvider): VoiceInfo[] {
  return provider ? ROWS.filter((v) => v.provider === provider) : [...ROWS];
}

/** Look up by curated friendly name OR by full provider voice id — a caller may
 *  legitimately pass either. Anything else is untracked (undefined = fail-open). */
export function getVoice(nameOrId: string): VoiceInfo | undefined {
  return ROWS.find((v) => v.name === nameOrId || v.id === nameOrId);
}

/** TEST-ONLY. Mark curated voices retired so the third state can be exercised while
 *  no real retirement exists. Deliberately not exported from the package entry —
 *  a consumer must never be able to mark our roster dead. Pair with
 *  resetVoiceRegistry() so a test cannot leak state into the next one. */
export function setRetiredVoicesForTests(map: Record<string, string>): void {
  RETIRED = map;
  ROWS = build();
}

/** TEST-ONLY. Restore the shipped registry. */
export function resetVoiceRegistry(): void {
  RETIRED = RETIRED_DEFAULT;
  ROWS = build();
}
