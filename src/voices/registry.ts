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
  // Every one of the 5 curated ids probed with GET /v1/voices/{id}; 4 returned
  // 200, `mads` returned voice_not_found (see RETIRED below). A bogus id was
  // probed alongside as a negative control, so a 200 means something.
  elevenlabs: "2026-08-11",
  // F026 (6ca38c4) verified the 6 curated names against Azure's voices/list. Not
  // re-probed since: this machine has no Azure Speech key, and inventing a fresher
  // date than the last real check is exactly the lie checkedAt exists to prevent.
  azure: "2026-06-23",
};

/** Voices we know are GONE — keyed by curated name. A row here is the third state
 *  the old two-state resolveVoice could not express. Keep the entry: deleting it
 *  would send the friendly name to the provider as a raw voice id. */
const RETIRED: Record<string, string> = {
  mads: "retired — ElevenLabs no longer serves this voice id; GET /v1/voices/BIWC0507fYMfhPcAEIRP returns voice_not_found (measured 2026-08-11)",
};

/** Genders as published by the provider. Absent = we have no source; never
 *  inferred from a first name. `mads` is absent because the voice is gone, so
 *  there is nothing left to ask. */
const ELEVENLABS_GENDER: Record<string, "female" | "male"> = {
  soren: "male",
  jesper: "male",
  noam: "male",
  camilla: "female",
};

function build(): VoiceInfo[] {
  const rows: VoiceInfo[] = [];

  for (const [name, id] of Object.entries(ELEVENLABS_DANISH_VOICES)) {
    const note = RETIRED[name];
    rows.push({
      id,
      name,
      provider: "elevenlabs",
      // The curated ElevenLabs roster IS the Danish one (see the constant's name
      // + F020); the multilingual model speaks it as da-DK.
      locale: "da-DK",
      gender: ELEVENLABS_GENDER[name],
      available: note === undefined,
      status: note === undefined ? "available" : "retired",
      note,
      checkedAt: CHECKED_AT.elevenlabs,
    });
  }

  for (const v of AZURE_DANISH_VOICE_LIST) {
    const note = RETIRED[v.name];
    rows.push({
      id: v.voiceId,
      name: v.name,
      provider: "azure",
      locale: localeOf(v.voiceId),
      gender: v.gender,
      available: note === undefined,
      status: note === undefined ? "available" : "retired",
      note,
      checkedAt: CHECKED_AT.azure,
    });
  }

  return rows;
}

const ROWS: VoiceInfo[] = build();

/** All curated voices, newest status applied. Optionally scoped to one provider. */
export function allVoices(provider?: VoiceProvider): VoiceInfo[] {
  return provider ? ROWS.filter((v) => v.provider === provider) : [...ROWS];
}

/** Look up by curated friendly name OR by full provider voice id — a caller may
 *  legitimately pass either. Anything else is untracked (undefined = fail-open). */
export function getVoice(nameOrId: string): VoiceInfo | undefined {
  return ROWS.find((v) => v.name === nameOrId || v.id === nameOrId);
}
