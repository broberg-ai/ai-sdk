// F037.1 — the voice registry + listVoices().
import { afterEach, describe, expect, test } from "bun:test";
import { listVoices, checkVoice } from "./index.js";
import { getVoice, setRetiredVoicesForTests, resetVoiceRegistry } from "./registry.js";
import { ELEVENLABS_DANISH_VOICES } from "../providers/elevenlabs.js";
import { AZURE_DANISH_VOICE_LIST } from "../providers/azure.js";

afterEach(resetVoiceRegistry);

describe("listVoices", () => {
  test("returns every curated voice from both providers", () => {
    const rows = listVoices();
    expect(rows).toHaveLength(11);
    expect(rows.filter((v) => v.provider === "elevenlabs")).toHaveLength(5);
    expect(rows.filter((v) => v.provider === "azure")).toHaveLength(6);
  });

  test("every row carries the fields a picker renders", () => {
    for (const v of listVoices()) {
      expect(typeof v.id).toBe("string");
      expect(v.id.length).toBeGreaterThan(0);
      expect(typeof v.name).toBe("string");
      expect(["elevenlabs", "azure"]).toContain(v.provider);
      expect(v.locale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(typeof v.available).toBe("boolean");
      expect(["available", "retired", "unknown"]).toContain(v.status);
    }
  });

  test("every row's checkedAt is a real ISO date, so staleness is visible", () => {
    for (const v of listVoices()) {
      expect(Number.isFinite(Date.parse(v.checkedAt))).toBe(true);
      // A date in the future would mean someone invented it.
      expect(Date.parse(v.checkedAt)).toBeLessThanOrEqual(Date.now());
    }
  });

  test("the two providers carry their OWN last-checked date, not a shared one", () => {
    // Collapsing these to one date would claim the Azure roster was re-checked
    // today, which it was not — there is no Azure key on the machine that built it.
    const eleven = new Set(listVoices({ provider: "elevenlabs" }).map((v) => v.checkedAt));
    const azure = new Set(listVoices({ provider: "azure" }).map((v) => v.checkedAt));
    expect(eleven.size).toBe(1);
    expect(azure.size).toBe(1);
    expect([...eleven][0]).not.toBe([...azure][0]);
  });

  test("gender is present where the provider publishes it, never guessed", () => {
    // All 6 Azure rows: gender comes from AZURE_DANISH_VOICE_LIST.
    for (const v of listVoices({ provider: "azure" })) {
      expect(v.gender).toBeDefined();
      expect(["female", "male"]).toContain(v.gender as string);
    }
    // ElevenLabs: 4 were labelled by the provider's voices endpoint. `mads` is not
    // saved to the account, so that endpoint describes nothing about it — and an
    // absent field is honest where a guess from a first name would not be.
    const eleven = listVoices({ provider: "elevenlabs" });
    expect(eleven.filter((v) => v.gender !== undefined)).toHaveLength(4);
    expect(eleven.find((v) => v.gender === undefined)?.name).toBe("mads");
  });

  test("provider scoping returns only that provider's rows", () => {
    expect(listVoices({ provider: "azure" }).every((v) => v.provider === "azure")).toBe(true);
    expect(listVoices({ provider: "elevenlabs" }).every((v) => v.provider === "elevenlabs")).toBe(true);
  });

  test("the returned array cannot mutate the registry", () => {
    listVoices().pop();
    expect(listVoices()).toHaveLength(11);
  });
});

describe("what ships: every curated voice is available", () => {
  test("no curated voice is marked retired", () => {
    // All 11 were verified before release — the 5 ElevenLabs ids by real synthesis
    // (POST /v1/text-to-speech/{id} → 200, distinct audio per voice, fabricated id
    // → 404), the 6 Azure names by F026 against Azure's voices/list.
    expect(listVoices().filter((v) => !v.available)).toHaveLength(0);
  });

  test("a caveat is not unavailability", () => {
    // `mads` carries a note (no published metadata) but is perfectly usable. A
    // picker must not grey it out.
    const mads = listVoices().find((v) => v.name === "mads");
    expect(mads?.available).toBe(true);
    expect(mads?.status).toBe("available");
    expect(mads?.note).toContain("usable");
  });
});

describe("the retired state — the third state resolveVoice could not express", () => {
  test("a retired voice reports available:false with a reason", () => {
    setRetiredVoicesForTests({ camilla: "retired — test fixture" });
    const camilla = listVoices().find((v) => v.name === "camilla");
    expect(camilla?.available).toBe(false);
    expect(camilla?.status).toBe("retired");
    expect(camilla?.note).toContain("test fixture");
  });

  test("a retired voice is KEPT in the roster, not deleted", () => {
    // Deleting it is the trap this feature exists to avoid: the friendly name
    // would then be POSTed to the provider as a raw voice id.
    setRetiredVoicesForTests({ camilla: "retired — test fixture" });
    expect(ELEVENLABS_DANISH_VOICES.camilla).toBe("4RklGmuxoAskAbGXplXN");
    expect(getVoice("camilla")).toBeDefined();
    expect(checkVoice("camilla").ok).toBe(false);
  });

  test("retiring one voice leaves the others alone", () => {
    setRetiredVoicesForTests({ camilla: "retired — test fixture" });
    expect(listVoices().filter((v) => !v.available).map((v) => v.name)).toEqual(["camilla"]);
  });

  test("the test hook cannot leak — reset restores the shipped registry", () => {
    setRetiredVoicesForTests({ camilla: "retired — test fixture" });
    resetVoiceRegistry();
    expect(listVoices().filter((v) => !v.available)).toHaveLength(0);
  });
});

describe("the curated rosters are the single source — this module only adds status", () => {
  test("ElevenLabs names and ids are unchanged", () => {
    const rows = listVoices({ provider: "elevenlabs" });
    for (const [name, id] of Object.entries(ELEVENLABS_DANISH_VOICES)) {
      expect(rows.find((v) => v.name === name)?.id).toBe(id);
    }
    expect(rows).toHaveLength(Object.keys(ELEVENLABS_DANISH_VOICES).length);
  });

  test("Azure names, ids and genders are unchanged", () => {
    const rows = listVoices({ provider: "azure" });
    for (const v of AZURE_DANISH_VOICE_LIST) {
      const row = rows.find((r) => r.name === v.name);
      expect(row?.id).toBe(v.voiceId);
      expect(row?.gender).toBe(v.gender);
    }
    expect(rows).toHaveLength(AZURE_DANISH_VOICE_LIST.length);
  });

  test("locale is derived from the voice id, not restated", () => {
    const rows = listVoices({ provider: "azure" });
    expect(rows.find((v) => v.name === "christel")?.locale).toBe("da-DK");
    // Seraphina is a de-DE multilingual voice speaking Danish — reporting da-DK
    // would be a nicer lie than the truth the adapter actually sends as xml:lang.
    expect(rows.find((v) => v.name === "seraphina")?.locale).toBe("de-DE");
  });
});

describe("getVoice", () => {
  test("matches by curated name and by full provider id", () => {
    expect(getVoice("christel")?.id).toBe("da-DK-ChristelNeural");
    expect(getVoice("da-DK-ChristelNeural")?.name).toBe("christel");
    expect(getVoice("soren")?.id).toBe("xj6X4BCUsv9oxohm1E8o");
    expect(getVoice("xj6X4BCUsv9oxohm1E8o")?.name).toBe("soren");
  });

  test("an untracked id is undefined, not an error", () => {
    expect(getVoice("some-raw-provider-voice-id")).toBeUndefined();
  });
});
