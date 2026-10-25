// The "System One" decision protocol (F066, F081.2): one POST with a `state` and a map of
// typed `questions`, answered per question id with calibrated probabilities. TypeSafe's
// Jev and Microsoft-Decision-1 speak the SAME wire form (measured live on both), so the
// answer mapping lives here once instead of drifting apart in two adapters.
import type { JudgeAnswer, JudgeEntry, JudgeQuestion } from "../types.js";

export type SystemOneWireAnswer = {
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, JudgeEntry>;
  confidence?: number;
};

/** Map every wire answer onto the question we ASKED. The type comes from our own
 *  question, not from the response: the live API returns a `type` field that the
 *  documentation's example does not show, and a contract read off an undocumented
 *  field is a contract that breaks the day the docs are right. */
export function mapSystemOneAnswers(
  label: string,
  questions: Record<string, JudgeQuestion>,
  wire: Record<string, SystemOneWireAnswer> | undefined,
): Record<string, JudgeAnswer> {
  const answers: Record<string, JudgeAnswer> = {};
  for (const [id, q] of Object.entries(questions)) answers[id] = mapOne(label, id, q, wire?.[id]);
  return answers;
}

function mapOne(label: string, id: string, q: JudgeQuestion, a: SystemOneWireAnswer | undefined): JudgeAnswer {
  // A question that came back without an answer must not become `undefined` sitting
  // where an answer should be — that is a "no" arriving shaped like a "yes".
  if (!a) throw new Error(`${label}: no answer returned for question "${id}"`);
  const num = (v: unknown, field: string): number => {
    if (typeof v !== "number") throw new Error(`${label}: "${id}" answer has no numeric ${field}`);
    return v;
  };
  if (q.type === "noul") return { type: "noul", noul: num(a.noul, "noul") };
  if (q.type === "choice") {
    if (typeof a.choice !== "string") throw new Error(`${label}: "${id}" answer has no choice`);
    return {
      type: "choice",
      choice: a.choice,
      probabilities: a.probabilities ?? {},
      confidence: num(a.confidence, "confidence"),
    };
  }
  return {
    type: "score",
    score: num(a.score, "score"),
    probabilities: a.probabilities ?? {},
    legend: a.legend ?? {},
    confidence: num(a.confidence, "confidence"),
  };
}
