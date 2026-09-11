// F055 — word timings: mapping Azure's spoken word list back to the MANUSCRIPT.
//
// cms asked us to confirm that Azure's `[nnnn].word.json` carries a text offset —
// "the field that carries the whole feature". MEASURED in Microsoft's own example,
// not read from a summary:
//
//   [ { "Text": "The", "AudioOffset": 50, "Duration": 137 },
//     { "Text": ".",   "AudioOffset": 1700, "Duration": 100 } ]
//
// Three fields. There is NO text offset. Shipping `textOffset` as the request described
// it would have put a field in the type that is `undefined` in every row — the exact
// defect F052 removed from `classify`.
//
// So the link back to the manuscript is DERIVED here, and that is the part worth owning
// centrally: a sequential walk with traps, which five consumers would get wrong five ways.

/** One entry of Azure's `[nnnn].word.json`, verbatim field names. */
export interface AzureWordBoundary {
  Text: string;
  /** Milliseconds into the audio. */
  AudioOffset: number;
  /** Milliseconds. */
  Duration: number;
}

export interface WordTiming {
  /** The spoken word, as Azure reported it. */
  text: string;
  startMs: number;
  endMs: number;
  /** Character span in the SOURCE text. Several spoken words share one span when they
   *  came from one substituted manuscript word. */
  sourceStart: number;
  sourceEnd: number;
}

export interface AlignedWordTimings {
  /** Every word we could place in the source, in audio order. */
  words: WordTiming[];
  /** Spoken words we could NOT place, in order, verbatim.
   *
   *  Named rather than dropped, and never given a guessed offset. "I could not place
   *  this" and "it was here" must not be the same answer — the same discipline as
   *  `rerank.unscored` (F052). A highlighter that treats `words` as complete must look
   *  here. */
  unaligned: string[];
}

/** A pronunciation entry, narrowed to what alignment needs. */
export interface AliasEntry {
  word: string;
  alias?: string;
}

/** Characters Azure emits as their own entry, carrying nothing for a highlighter.
 *  A set rather than a regex so the test is exact membership — a rule that stripped
 *  dots would also break "broberg.ai", which is ONE word in the manuscript. */
const PUNCTUATION = new Set([".", ",", "!", "?", ":", ";", "…", "—", "–", '"', "'", "(", ")"]);

const fold = (s: string): string => s.toLowerCase();

/**
 * Map Azure's spoken word list onto positions in the SOURCE text.
 *
 * Two rules carry the whole function:
 *
 * **The walk only moves FORWARD.** That is what puts a repeated word on its own
 * occurrence — "AI er AI" must not place the second on the first. Searching from 0 each
 * time passes every test with distinct words and fails silently on real prose.
 *
 * **A substitution is matched as a RUN, not word by word.** Azure speaks SSML, so
 * `<sub alias='broberg punktum a i'>broberg.ai</sub>` puts four words in the list where
 * the manuscript has one. Matching them individually is not merely imprecise, it is
 * wrong in a way that bites every Danish text: MEASURED on cms's own dictionary entry,
 * a per-word map made the alias's "i" swallow the next real Danish word "i" in
 * "broberg.ai i dag". An alias's parts are often ordinary words ("a", "i", "punktum"),
 * so a lookup table cannot be the mechanism — the run has to be consumed positionally.
 */
export function alignWordTimings(
  text: string,
  words: AzureWordBoundary[],
  opts: { pronunciations?: AliasEntry[] } = {},
): AlignedWordTimings {
  const out: WordTiming[] = [];
  const unaligned: string[] = [];
  const haystack = fold(text);

  // Longest alias first, so a short alias that is a prefix of a longer one cannot claim
  // the run. Same reasoning as F051's longest-first alternation.
  const aliases = (opts.pronunciations ?? [])
    .filter((p): p is { word: string; alias: string } => typeof p.alias === "string" && p.alias.trim() !== "")
    .map((p) => ({ word: p.word, parts: p.alias.trim().split(/\s+/).map(fold) }))
    .sort((a, b) => b.parts.length - a.parts.length);

  // Punctuation is dropped BEFORE the run match, so a comma inside an alias's spoken
  // output cannot break the run apart.
  const spoken = words.filter((w) => !PUNCTUATION.has(w.Text.trim()));

  let cursor = 0;
  let i = 0;
  while (i < spoken.length) {
    // 1. Does a substitution start here? Check the upcoming words against each alias,
    //    and require the SOURCE word to actually be findable ahead of the cursor —
    //    otherwise a coincidental word sequence would consume source text it never came
    //    from.
    let consumed = false;
    for (const a of aliases) {
      if (i + a.parts.length > spoken.length) continue;
      const matches = a.parts.every((part, k) => fold(spoken[i + k]!.Text) === part);
      if (!matches) continue;
      const at = haystack.indexOf(fold(a.word), cursor);
      if (at === -1) continue;

      const span = { start: at, end: at + a.word.length };
      for (let k = 0; k < a.parts.length; k++) {
        const w = spoken[i + k]!;
        out.push({
          text: w.Text,
          startMs: w.AudioOffset,
          endMs: w.AudioOffset + w.Duration,
          sourceStart: span.start,
          sourceEnd: span.end,
        });
      }
      cursor = span.end;
      i += a.parts.length;
      consumed = true;
      break;
    }
    if (consumed) continue;

    // 2. An ordinary word.
    const w = spoken[i]!;
    const at = haystack.indexOf(fold(w.Text), cursor);
    if (at === -1) {
      unaligned.push(w.Text);
    } else {
      out.push({
        text: w.Text,
        startMs: w.AudioOffset,
        endMs: w.AudioOffset + w.Duration,
        sourceStart: at,
        sourceEnd: at + w.Text.length,
      });
      cursor = at + w.Text.length;
    }
    i++;
  }

  return { words: out, unaligned };
}
