// F051 — the pronunciation dictionary's substitution engine.
//
// Its own module because BOTH speech adapters need it and they need DIFFERENT halves:
// Azure wraps matches in SSML, ElevenLabs (which has no SSML) can only swap in an alias.
// One matcher, two renderers — a second copy would drift, and the security reasoning
// below is not something to repeat in two files.

/** One dictionary entry. `alias` says it differently; `ipa` says it precisely. */
export interface Pronunciation {
  /** The word as it appears in the text. Matched whole-word, case-insensitively. */
  word: string;
  /** Say this instead. Azure `<sub alias>`; ElevenLabs plain substitution. */
  alias?: string;
  /** IPA phonemes. Azure `<phoneme alphabet="ipa" ph>`. ElevenLabs cannot do this. */
  ipa?: string;
  /** Reserved for a future per-entry language switch; carried but not yet emitted. */
  lang?: string;
}

/** XML-escape. Exported so the adapters escape text and attribute values with the SAME
 *  function — two escapers would eventually disagree, and the disagreement would be a
 *  hole rather than a cosmetic difference. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reject a dictionary we cannot execute. Called by both adapters before any output.
 *
 *  Both `alias` and `ipa` on one entry is REFUSED rather than resolved: picking one
 *  silently is the success-shaped non-answer this repo spent two days removing, and the
 *  caller who wrote both has a belief about which applies that we cannot read. */
export function assertPronunciations(list: Pronunciation[] | undefined, provider: string): void {
  for (const p of list ?? []) {
    if (!p.word.trim()) {
      throw new Error(`${provider} adapter: a pronunciation entry has an empty "word".`);
    }
    if (p.alias !== undefined && p.ipa !== undefined) {
      throw new Error(
        `${provider} adapter: pronunciation "${p.word}" sets BOTH alias and ipa. ` +
          `They are different instructions — alias says it differently, ipa says it ` +
          `precisely. Pick one.`,
      );
    }
    if (p.alias === undefined && p.ipa === undefined) {
      throw new Error(
        `${provider} adapter: pronunciation "${p.word}" sets neither alias nor ipa, ` +
          `so there is nothing to say instead.`,
      );
    }
  }
}

/** Apply the dictionary in ONE pass, longest word first.
 *
 *  Both properties are load-bearing, and sequential `String.replace` calls break both:
 *
 *  - **Overlap.** "AI" and "broberg.ai" both occur in "broberg.ai". Replacing "AI"
 *    first destroys the longer match; longest-first in a single alternation lets the
 *    specific rule win at that position.
 *  - **Re-entry.** After inserting `<sub alias="A I">AI</sub>`, a later rule for a
 *    common word — `sub`, `alias`, `ph` — would match INSIDE the markup the first rule
 *    just wrote. One pass over the original string cannot do that.
 *
 *  `haystack` is expected to be ALREADY ESCAPED for the target format, so each search
 *  word is escaped the same way before matching: a word containing `&` appears as
 *  `&amp;` in the text and would otherwise never be found.
 */
export function applyPronunciations(
  haystack: string,
  list: Pronunciation[] | undefined,
  render: (entry: Pronunciation, matched: string) => string,
  escape: (s: string) => string = (s) => s,
): string {
  const entries = (list ?? []).filter((p) => p.word.trim().length > 0);
  if (entries.length === 0) return haystack;

  // Longest first. Sorting on the ESCAPED length, since that is what the regex sees.
  const sorted = [...entries].sort((a, b) => escape(b.word).length - escape(a.word).length);
  const byLower = new Map<string, Pronunciation>();
  for (const p of sorted) {
    const k = escape(p.word).toLowerCase();
    if (!byLower.has(k)) byLower.set(k, p); // first (longest) wins a duplicate spelling
  }

  // Whole-word via lookaround, NOT \b: \b is defined on word characters, so it behaves
  // wrongly around the dot in "broberg.ai". This also lets "AI" match after the dot —
  // which is exactly why longest-first matters rather than being an alternative to it.
  const alternation = sorted.map((p) => escapeRegex(escape(p.word))).join("|");
  const re = new RegExp(`(?<![\\w-])(${alternation})(?![\\w-])`, "gi");

  return haystack.replace(re, (matched) => {
    const entry = byLower.get(matched.toLowerCase());
    return entry ? render(entry, matched) : matched;
  });
}
