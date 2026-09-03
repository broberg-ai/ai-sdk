// F046.3 — the detector is checked against the ACTUAL answers from the measurement,
// not against sentences written to make it pass. Those two differ more than they look:
// a hand-written "Danish sentence" would use the markers I already put in the list.
import { expect, test } from "bun:test";
import { detectNordic } from "./lang-detect.js";

// Verbatim from the 2026-09-03 run against mistral-large-latest.
const DANISH_ANSWER_TO_A_NORWEGIAN_QUESTION =
  "Tak for din henvendelse! Leveringstid til Bergen er typisk 2-3 arbejdsdage med " +
  "vores standardtransportservice. For præcis info på din ordre, tjek venligst din " +
  "ordrebekræftelse eller kontakt os med ordrenummer.";
const NORWEGIAN_ANSWER =
  "Takk for henvendelsen! Leveringstiden til Bergen er normalt 2–3 virkedager med " +
  "vårt standard fraktselskap. Jeg sjekker gjerne opp aktuell status for deg.";
const SWEDISH_ANSWER =
  "Hej! Tack för din förfrågan. Jag kontrollerar leveransstatusen för order 44821 och " +
  "återkommer till dig inom en timme med ett exakt leveransdatum. Ursäkta besväret!";

test("the leak this exists to find: Danish sent to a Norwegian customer", () => {
  expect(detectNordic(DANISH_ANSWER_TO_A_NORWEGIAN_QUESTION)).toBe("da");
});

test("the same question answered correctly is NOT flagged", () => {
  // The negative control that matters: a detector returning "da" for everything would
  // pass the test above and be worthless.
  expect(detectNordic(NORWEGIAN_ANSWER)).toBe("no");
  expect(detectNordic(SWEDISH_ANSWER)).toBe("sv");
});

test("no evidence gives '?', never a guess", () => {
  // A confident wrong label ends the inspection; "?" sends it to a human. Both of these
  // are genuinely unclassifiable on 40 words, and saying so is the correct answer.
  expect(detectNordic("Ok.")).toBe("?");
  expect(detectNordic("")).toBe("?");
  expect(detectNordic("12 kasser, ordre 44821.")).toBe("?");
});

test("Swedish orthography outranks a stray Danish-looking word", () => {
  // ä/ö is a hard signal; the word list is not. Without the weighting, a Swedish answer
  // containing one shared word could tie and come back "?" — an unsure verdict on a
  // sentence a human reads as obviously Swedish.
  expect(detectNordic("Vi återkommer när vi vet mer. Tack för tålamodet!")).toBe("sv");
});
