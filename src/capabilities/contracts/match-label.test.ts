// F052.2 — reported by helpdesk from a live customer ticket. A correct answer was being
// thrown away, silently, and the better a consumer used the API the likelier it got.
import { describe, expect, test } from "bun:test";
import { matchLabel } from "./index.js";

// helpdesk's REAL taxonomy from BR-2WYHD, verbatim — not a constructed example.
const HELPDESK = [
  "virker-ikke — noget er i stykker hos en der allerede bruger et af produkterne",
  "spørgsmål — nogen vil vide hvordan noget virker",
  "faktura — noget om betaling eller abonnement",
];

describe("F052.2 — the head of a decorated label resolves", () => {
  test("THE PRODUCTION CASE: the model answers the short form, and it counts", () => {
    expect(matchLabel("virker-ikke", HELPDESK)).toBe(HELPDESK[0]!);
  });

  test("the WHOLE decorated string still matches, untouched by normalisation", () => {
    expect(matchLabel(HELPDESK[1]!, HELPDESK)).toBe(HELPDESK[1]!);
  });

  test("no separator is assumed — a label joined by anything else still resolves", () => {
    // helpdesk flagged that hardcoding an em-dash only moves the cliff. A prefix needs
    // no separator, so these all work without the package knowing the convention.
    const labels = ["billing: payments and invoices", "billing_errors (legacy)", "support"];
    expect(matchLabel("support", labels)).toBe("support");
    expect(matchLabel("billing_errors", labels)).toBe("billing_errors (legacy)");
  });
});

describe("F052.2 — ambiguity gets null, never a guess", () => {
  const AMBIG = ["betaling — kort", "betaling — faktura"];

  test("a prefix of TWO labels resolves to neither", () => {
    // The bug this fix could have introduced: picking one would turn a discarded correct
    // answer into a confident WRONG one. That is worse than today, not better.
    expect(matchLabel("betaling", AMBIG)).toBeNull();
  });

  test("the unambiguous siblings still resolve", () => {
    // Negative control for the control: ambiguity must not poison the whole label set.
    expect(matchLabel("betaling — kort", AMBIG)).toBe("betaling — kort");
  });

  test("two labels differing ONLY in case resolve to neither", () => {
    expect(matchLabel("urgent", ["Urgent", "URGENT"])).toBeNull();
    expect(matchLabel("urgent", ["Urgent", "other"])).toBe("Urgent");
  });

  test("a WORD-BOUNDARY prefix only — a truncated answer is not a choice", () => {
    expect(matchLabel("bet", ["betaling — kort"])).toBeNull();
    expect(matchLabel("virker", HELPDESK)).toBeNull(); // "virker-ikke" continues with a letter
  });
});

describe("F052.2 — F052's whole point still stands", () => {
  test("an INVENTED category is still rejected", () => {
    expect(matchLabel("eskalering", HELPDESK)).toBeNull();
  });

  test("non-strings and empties are null, never a label", () => {
    for (const bad of [undefined, null, 42, {}, [], "", "   ", '""']) {
      expect(matchLabel(bad, HELPDESK)).toBeNull();
    }
  });

  test("quotes and whitespace around a real answer are forgiven", () => {
    expect(matchLabel('  "virker-ikke"  ', HELPDESK)).toBe(HELPDESK[0]!);
  });
});
