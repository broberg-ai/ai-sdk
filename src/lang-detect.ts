// F046.3 — a HEURISTIC language classifier for Nordic customer prose.
//
// It exists because the failure it detects is invisible to the people who would
// otherwise catch it: measured on mistral-large, Danish leaks into Norwegian and
// Swedish answers and never the other way round, and a Danish-speaking reviewer reads
// the Norwegian ones as fine. vn-leker's own words: "fejlen er usynlig præcis for dem
// der skal opdage den".
//
// IT IS A HEURISTIC AND MUST BE REPORTED AS ONE. Danish and Norwegian bokmål share
// `jeg`, `ikke`, `og` and most sentence shapes, so no marker list separates them
// reliably on 40 words. Every consumer of this must print the answer alongside the
// verdict so a human can overrule it. An "unsure" answer is `"?"`, never a guess:
// a confident wrong label is worse than no label, because it ends the inspection.

export type NordicLang = "da" | "no" | "sv" | "?";

/** Words that appear in exactly ONE of the three. Chosen from real model output, not
 *  from a grammar: these are the forms that actually differed in 30 measured answers. */
const MARKERS: Record<"da" | "no" | "sv", RegExp> = {
  da: /\b(tak for|jeg tjekker|jeg checker|arbejdsdage|hverdage|vender tilbage|hurtigst muligt|ulejlighed|undskyld|hjælper|hjælpe|ordrebekræftelse|venligst)\b/gi,
  no: /\b(takk|sjekker|sjekke|arbeidsdager|virkedager|kommer tilbake|så snart som mulig|beklager|henvendelsen|e-post|søppelpost|unnskyld|oppgi)\b/gi,
  sv: /\b(tack|kollar|kontrollerar|arbetsdagar|återkommer|snarast|ursäkta|beställde|beställning|trasiga|meddelande|förfrågan|leveransstatus)\b/gi,
};

/** Classify a short customer-service answer. `"?"` when the evidence does not separate
 *  the candidates — a tie or nothing recognised. */
export function detectNordic(text: string): NordicLang {
  const n: Record<"da" | "no" | "sv", number> = {
    da: (text.match(MARKERS.da) || []).length,
    no: (text.match(MARKERS.no) || []).length,
    sv: (text.match(MARKERS.sv) || []).length,
  };
  // Orthography is the one HARD signal in the set: ä/ö exist only in Swedish, and
  // æ/ø only in Danish/Norwegian. Weighted above the word list for that reason.
  if (/[äö]/.test(text)) n.sv += 2;
  if (/\bjag\b|\binte\b|\bär\b/i.test(text)) n.sv += 2;
  if (/[æø]/.test(text)) n.sv -= 1;

  const ranked = (Object.entries(n) as [Exclude<NordicLang, "?">, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  const [top, second] = ranked;
  if (!top || top[1] <= 0) return "?";
  if (second && top[1] === second[1]) return "?"; // a tie is not an answer
  return top[0];
}
