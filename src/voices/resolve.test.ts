// F037.2 — checkVoice(): resolve with fallback, mirroring resolveModel.
import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { checkVoice, listVoices, VoiceUnavailableError } from "./index.js";
import { resolveVoice, ELEVENLABS_DANISH_VOICES } from "../providers/elevenlabs.js";
import { setRetiredVoicesForTests, resetVoiceRegistry } from "./registry.js";

// No curated voice is actually retired today — all 11 were verified before release.
// The third state is exercised through the test-only hook so these tests keep
// working the day a REAL retirement lands, without depending on one existing.
const DEAD = "mads";
const FIXTURE_NOTE = "retired — test fixture, not a real retirement";

beforeEach(() => setRetiredVoicesForTests({ [DEAD]: FIXTURE_NOTE }));
afterEach(resetVoiceRegistry);

describe("checkVoice — available", () => {
  test("a live ElevenLabs name resolves to its voice id", () => {
    const r = checkVoice("soren");
    expect(r).toMatchObject({
      ok: true,
      voiceId: "xj6X4BCUsv9oxohm1E8o",
      requested: "soren",
      provider: "elevenlabs",
      fellBack: false,
      status: "available",
    });
  });

  test("a live Azure name resolves to its full Azure voice", () => {
    const r = checkVoice("christel");
    expect(r).toMatchObject({
      ok: true,
      voiceId: "da-DK-ChristelNeural",
      provider: "azure",
      fellBack: false,
      status: "available",
    });
  });

  test("a full provider id we track resolves to itself", () => {
    expect(checkVoice("da-DK-ChristelNeural").voiceId).toBe("da-DK-ChristelNeural");
  });
});

describe("checkVoice — retired", () => {
  test("falls back when given a usable alternative", () => {
    const r = checkVoice(DEAD, { fallback: "soren" });
    expect(r.ok).toBe(false);
    expect(r.fellBack).toBe(true);
    expect(r.voiceId).toBe("xj6X4BCUsv9oxohm1E8o");
    expect(r.requested).toBe(DEAD);
    expect(r.reason).toContain(FIXTURE_NOTE);
  });

  test("walks a fallback chain in order and takes the first usable one", () => {
    // A dead first fallback must be skipped, not accepted.
    const r = checkVoice(DEAD, { fallback: [DEAD, "camilla"] });
    expect(r.fellBack).toBe(true);
    expect(r.voiceId).toBe(ELEVENLABS_DANISH_VOICES.camilla as string);
  });

  test("an untracked fallback is accepted verbatim (fail-open, like resolveModel)", () => {
    const r = checkVoice(DEAD, { fallback: "some-raw-voice-id" });
    expect(r.fellBack).toBe(true);
    expect(r.voiceId).toBe("some-raw-voice-id");
  });

  test("without a fallback it returns ok:false and says why", () => {
    const r = checkVoice(DEAD);
    expect(r.ok).toBe(false);
    expect(r.fellBack).toBe(false);
    expect(r.status).toBe("retired");
    expect(r.reason).toContain(FIXTURE_NOTE);
  });

  test("throwIfUnavailable throws a flaggable error", () => {
    let caught: unknown;
    try {
      checkVoice(DEAD, { throwIfUnavailable: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VoiceUnavailableError);
    expect((caught as VoiceUnavailableError).code).toBe("voice_unavailable");
    expect((caught as VoiceUnavailableError).requested).toBe(DEAD);
    expect((caught as VoiceUnavailableError).provider).toBe("elevenlabs");
  });

  test("throwIfUnavailable does NOT throw when a fallback saves it", () => {
    expect(checkVoice(DEAD, { fallback: "soren", throwIfUnavailable: true }).voiceId).toBe(
      "xj6X4BCUsv9oxohm1E8o",
    );
  });
});

describe("checkVoice — untracked is fail-open", () => {
  test("a raw provider voice id passes through unchanged", () => {
    const r = checkVoice("21m00Tcm4TlvDq8ikWAM");
    expect(r).toMatchObject({
      ok: true,
      voiceId: "21m00Tcm4TlvDq8ikWAM",
      fellBack: false,
      status: "unknown",
    });
    expect(r.provider).toBeUndefined();
  });

  test("we never block a voice we simply do not track", () => {
    expect(checkVoice("de-DE-KatjaNeural").ok).toBe(true);
  });
});

describe("REGRESSION GUARD — resolveVoice is untouched", () => {
  // The plan-doc originally promised checkVoice's shape UNDER the name resolveVoice
  // while also promising backwards compatibility. Those cannot both hold: this is
  // the test that would have caught the break.
  test("still returns a string, not a result object", () => {
    const out = resolveVoice("soren");
    expect(typeof out).toBe("string");
    expect(out).toBe("xj6X4BCUsv9oxohm1E8o");
  });

  test("still maps every curated ElevenLabs name to its id", () => {
    for (const [name, id] of Object.entries(ELEVENLABS_DANISH_VOICES)) {
      expect(resolveVoice(name)).toBe(id);
    }
  });

  test("still passes an unknown value through verbatim", () => {
    expect(resolveVoice("da-DK-ChristelNeural")).toBe("da-DK-ChristelNeural");
    expect(resolveVoice("anything-else")).toBe("anything-else");
  });

  test("and it still maps the RETIRED voice — the mapper does not gate", () => {
    // Deliberate: resolveVoice maps, checkVoice gates. Conflating the two is what
    // made a retirement impossible to express in the first place.
    expect(resolveVoice(DEAD)).toBe(ELEVENLABS_DANISH_VOICES[DEAD] as string);
  });
});

describe("one idiom for models and voices", () => {
  test("checkVoice's result carries the same keys resolveModel's does", () => {
    const r = checkVoice("soren");
    for (const k of ["ok", "requested", "fellBack", "status"]) {
      expect(Object.keys(r)).toContain(k);
    }
  });

  test("listVoices is the picker read, like listModels", () => {
    expect(listVoices().some((v) => v.available === false)).toBe(true);
  });
});
