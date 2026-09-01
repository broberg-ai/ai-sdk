// F045 — a doc comment that names a route must name the route we actually take.
//
// super bought a fal API key because `ProviderAdapter.animate`'s doc said "fal.", and
// then got "gemini adapter: API key not set" from a call with no override. The sentence
// was true when F024 first shipped; the default later moved to Veo direct via Gemini and
// nothing tied the sentence to the decision, so only the sentence stayed behind.
//
// This is not a spell-check. The comment ships inside index.d.ts, which means it is what
// the editor tooltip shows at the exact moment a consumer decides WHICH API KEY TO BUY —
// so a stale one costs an account signup and a failed run, not a moment of confusion.
//
// THE RULE IS "DO NOT MAKE A WRONG CLAIM", NOT "ALWAYS MAKE A CLAIM". A member doc that
// names no provider is fine — it promises nothing. One that names a provider must name
// the default's. That is why `chat` and `translate` are absent below: they route via a
// tier, have no DEFAULT_*_SPEC, and mention a provider only as an example.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const types = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("./client.ts", import.meta.url), "utf8");

const PROVIDERS = [
  "fal", "gemini", "vertex", "mistral", "anthropic", "openai",
  "elevenlabs", "azure", "bfl", "deepl", "deepseek", "openrouter",
];

/** ProviderAdapter member → the const that decides where that call actually goes. */
const MEMBER_SPEC: Record<string, string> = {
  image: "DEFAULT_IMAGE_SPEC",
  animate: "DEFAULT_ANIMATE_SPEC",
  trainStyle: "DEFAULT_TRAINSTYLE_SPEC",
  ocr: "DEFAULT_OCR_SPEC",
  moderate: "DEFAULT_MODERATION_SPEC",
  dialogue: "DEFAULT_PODCAST_SPEC",
  tts: "DEFAULT_TTS_SPEC",
  batchSubmit: "DEFAULT_BATCH_SPEC",
};

function specProvider(name: string): string {
  const m = client.match(new RegExp(`const ${name}[^=]*=\\s*\\{[^}]*provider:\\s*"(\\w+)"`));
  if (!m) throw new Error(`${name} not found in client.ts — the map above is stale`);
  return m[1]!;
}

/** The doc block immediately above a ProviderAdapter member, flattened to one line. */
function memberDoc(member: string): string {
  const block = types.match(/export interface ProviderAdapter \{([\s\S]*?)\n\}/);
  if (!block) throw new Error("ProviderAdapter interface not found in types.ts");
  // (?:(?!\*\/)[\s\S])*? — non-greedy AND forbidden from crossing a closing "*/", so the
  // block is THIS member's own doc. Without that guard the match starts at an earlier
  // member's comment and swallows everything between, which made a mutation run report
  // "animate doc says fal/deepl" — deepl belongs to `translate`, three members above.
  // It could equally have accused an innocent member of a claim it never made.
  const m = block[1]!.match(new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*?)\\*/\\s*${member}\\?`));
  return m ? m[1]!.replace(/\s+/g, " ") : "";
}

test("the map itself is live — every named spec still exists", () => {
  // Without this, deleting a DEFAULT_*_SPEC would make its assertion vanish rather than
  // fail, and the guard would quietly stop guarding that capability.
  for (const spec of Object.values(MEMBER_SPEC)) {
    expect(() => specProvider(spec)).not.toThrow();
  }
  expect(Object.keys(MEMBER_SPEC).length).toBeGreaterThanOrEqual(8);
});

test("a member doc that names a provider names the DEFAULT one", () => {
  const wrong: string[] = [];
  for (const [member, spec] of Object.entries(MEMBER_SPEC)) {
    const doc = memberDoc(member);
    if (!doc) continue;
    // Check the WHOLE doc, minus the clauses that legitimately name somewhere else.
    //
    // The first version of this test took only the first sentence, on the theory that the
    // route claim lives there. Mutation-testing it destroyed that theory: the shipped bug
    // was "…into a short clip. fal." — the provider name sat in the SECOND sentence, so
    // the heuristic discarded the exact word under test and the guard passed on the very
    // defect it was written for. A green test that cannot see its own bug is worse than
    // no test, because it also reports coverage.
    const claim = doc
      .replace(/Override to[\s\S]*?(?=\.\s|$)/gi, " ")     // "Override to {provider:'fal'}…"
      .replace(/\{\s*provider:[^}]*\}/g, " ");             // any inline spec literal
    const named = PROVIDERS.filter((p) => new RegExp(`\\b${p}\\b`, "i").test(claim));
    if (named.length === 0) continue; // no claim made — allowed
    const actual = specProvider(spec);
    if (!named.includes(actual)) {
      wrong.push(
        `ProviderAdapter.${member} doc says ${named.join("/")} but ${spec} routes to "${actual}"`,
      );
    }
  }
  // Name the offender. A bare count tells the next reader nothing about WHICH sentence
  // is lying, and this whole class exists because nobody could see the disagreement.
  expect(wrong).toEqual([]);
});
