// Translate capability helper. A thin prompt-contract on top of chat — the
// client orchestrates (tier/budget/sink); this builds the messages. Default
// tier: "fast". Returns the translation only, no preamble.
import type { TranslateInput } from "../schema/inputs.js";
import type { Message, Tier } from "../types.js";

export const TRANSLATE_DEFAULT_TIER: Tier = "fast";

const TRANSLATE_SYSTEM =
  "You are a translation engine. Translate the user's text only. " +
  "Return the translation and nothing else — no preamble, no quotes.";

export function buildTranslateMessages(input: TranslateInput): Message[] {
  const fromClause = input.from ? ` from ${input.from}` : "";
  return [
    { role: "system", content: TRANSLATE_SYSTEM },
    { role: "user", content: `Translate${fromClause} to ${input.to}:\n\n${input.text}` },
  ];
}
