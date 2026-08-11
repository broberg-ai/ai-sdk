// F037.1 — the voice registry + listVoices().
import { describe, expect, test } from "bun:test";
import { listVoices, checkVoice } from "./index.js";
import { getVoice } from "./registry.js";
import { ELEVENLABS_DANISH_VOICES } from "../providers/elevenlabs.js";
import { AZURE_DANISH_VOICE_LIST } from "../providers/azure.js";

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

  test("gender is present where the provider publishes it, never guessed", () => {
    // All 6 Azure rows: gender comes from AZURE_DANISH_VOICE_LIST.
    for (const v of listVoices({ provider: "azure" })) {
      expect(v.gender).toBeDefined();
      expect(["female", "male"]).toContain(v.gender as string);
    }
    // ElevenLabs: the 4 live voices were labelled by the API; the retired one has
    // no source left, and an absent gender is honest where a guess would not be.
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

describe("the retired state — the third state resolveVoice could not express", () => {
  test("mads is reported dead, with a note saying why and when", () => {
    const mads = listVoices().find((v) => v.name === "mads");
    expect(mads).toBeDefined();
    expect(mads!.available).toBe(false);
    expect(mads!.status).toBe("retired");
    expect(mads!.note).toContain("voice_not_found");
    expect(mads!.note).toContain("2026-08-11");
  });

  test("the dead voice is KEPT in the roster, not deleted", () => {
    // Deleting it is the trap this feature exists to avoid: the friendly name
    // would then be POSTed to the provider as a raw voice id.
    expect(ELEVENLABS_DANISH_VOICES.mads).toBe("BIWC0507fYMfhPcAEIRP");
    expect(getVoice("mads")).toBeDefined();
    expect(checkVoice("mads").ok).toBe(false);
  });

  test("every other curated voice is still available", () => {
    const dead = listVoices().filter((v) => !v.available);
    expect(dead.map((v) => v.name)).toEqual(["mads"]);
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
