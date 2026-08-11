// F037 — voice availability (the voice counterpart to src/availability/).
export { listVoices, checkVoice } from "./resolve.js";
export type { CheckVoiceOptions } from "./resolve.js";
export { allVoices, getVoice } from "./registry.js";
export { VoiceUnavailableError } from "./types.js";
export type { VoiceInfo, VoiceProvider, VoiceStatus, VoiceResolveResult } from "./types.js";
