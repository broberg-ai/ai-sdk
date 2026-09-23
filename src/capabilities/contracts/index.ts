// Prompt-contract capabilities (F5.5). Each is a fixed system prompt over
// chat/vision; extract adds Zod output validation with one retry. Exposed as
// ai.contracts.* — built from the client so budget/cost tracking apply.
import type { AiClient, VisionInput } from "../../schema/inputs.js";
import type {
  Contracts,
  MockupInput,
  MockupResult,
  DesignInput,
  DesignResult,
  ExtractInput,
  ExtractResult,
  ClassifyInput,
  ClassifyResult,
  RerankInput,
  RerankResult,
} from "./types.js";

/** Pull the first JSON value out of a model reply (tolerates ```json fences + prose). */
/** How much of a raw model reply we keep when we could not use it — in `rawLabel` and
 *  in the rerank error. One constant because it was three literals, and a snippet that
 *  is 200 chars in one place and 100 in another is a diff nobody can read. */
const RAW_SNIPPET_CHARS = 200;

/** F060 — the sentence that lets the model refuse. Exported so the test can pin the
 *  exact words: this is the measured wording, and the whole finding is that dropping it
 *  silently converts refusals into confident wrong answers no aggregate score shows. */
export const CLASSIFY_ABSTAIN_SENTENCE = 'If none of the labels fit, return {"label": null}.';

export function parseJsonLoose(text: string): unknown {
  const fenced = text.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.search(/[[{]/);
  if (start === -1) throw new Error("no JSON found in model output");
  const slice = fenced.slice(start);
  // Walk back from the end to the matching closing bracket.
  const lastObj = slice.lastIndexOf("}");
  const lastArr = slice.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  return JSON.parse(slice.slice(0, end + 1));
}

type ChatVision = Pick<AiClient, "chat" | "vision">;

/** F052.2 — resolve the model's answer to one of the CALLER's labels, or to null.
 *
 *  Reported by helpdesk from a live customer ticket (BR-2WYHD, 15 September 2026). They
 *  pass labels carrying their own description — `"virker-ikke — noget er i stykker…"` —
 *  and the model answered `"virker-ikke"`, the canonical short form. That IS in their
 *  taxonomy. Exact equality threw a correct answer away, and it failed in the green
 *  direction: `label: null` reads as "the model could not decide", a legitimate outcome
 *  nobody investigates. The gradient runs TOWARD the bug — the better a consumer fills in
 *  the description, the longer the label, the likelier the model answers with the head.
 *
 *  NO SEPARATOR PARAMETER, deliberately. helpdesk proposed splitting on a separator and
 *  flagged themselves that hardcoding an em-dash just moves the cliff. A PREFIX needs no
 *  separator at all: "virker-ikke" is a prefix of the decorated label, whatever joins them.
 *
 *  AND AMBIGUITY MUST STAY null. If the answer prefixes TWO labels ("betaling" against
 *  "betaling — kort" and "betaling — faktura"), picking one would turn a discarded correct
 *  answer into a confident wrong one — a downgrade wearing a fix's clothes. */
export function matchLabel(answer: unknown, labels: string[]): string | null {
  if (typeof answer !== "string") return null;

  // 1. Exact, first and unconditionally: a model that echoes the whole decorated string
  //    must match without any normalisation deciding anything.
  if (labels.includes(answer)) return answer;

  // 2. Normalised: trim, drop surrounding quotes, case-fold. Only when it resolves to ONE.
  const norm = (s: string) => s.trim().replace(/^["'`]|["'`]$/g, "").trim().toLowerCase();
  const a = norm(answer);
  if (a.length === 0) return null;
  const exactish = labels.filter((l) => norm(l) === a);
  if (exactish.length === 1) return exactish[0]!;
  if (exactish.length > 1) return null; // two labels differing only in case — no guess.

  // 3. Prefix ending at WHITESPACE, and only when unique.
  //
  //    Whitespace rather than "any non-alphanumeric", and my own test caught the
  //    difference: a hyphen INSIDE a label name ("virker-ikke") is not a boundary, so the
  //    looser rule accepted the truncation "virker" as a choice. Every convention that
  //    appends a description puts a space before it — "name — desc", "name: desc",
  //    "name (legacy)" — so whitespace separates a name from its description without the
  //    package needing to know WHICH character the consumer joined them with.
  const prefixed = labels.filter((l) => {
    const n = norm(l);
    if (!n.startsWith(a)) return false;
    const next = n.charAt(a.length);
    return next === "" || /\s/.test(next);
  });
  return prefixed.length === 1 ? prefixed[0]! : null;
}

export function makeContracts(client: ChatVision): Contracts {
  return {
    async mockup(input: MockupInput): Promise<MockupResult> {
      const constraints = input.constraints ? `\n\nConstraints:\n${input.constraints}` : "";
      const res = await client.chat({
        system:
          "You are a UI mockup generator. Output a single self-contained HTML document " +
          "using Tailwind CSS utility classes. Return ONLY the HTML — no markdown, no prose.",
        prompt: `Build a UI mockup for:\n${input.description}${constraints}`,
        tier: input.tier ?? "smart",
        purpose: input.purpose ?? "contract:mockup",
      });
      return { html: res.text, usage: res.usage };
    },

    async design(input: DesignInput): Promise<DesignResult> {
      const res = await client.vision({
        image: input.screenshot as VisionInput["image"],
        prompt:
          "You are a design-iteration engine. Given this screenshot, apply the instructions " +
          `and return a single self-contained HTML document (Tailwind), ONLY the HTML.\n\n` +
          `Instructions:\n${input.instructions}`,
        tier: input.tier ?? "powerful",
        purpose: input.purpose ?? "contract:design",
      });
      return { html: res.text, usage: res.usage };
    },

    async extract<T>(input: ExtractInput<T>): Promise<ExtractResult<T>> {
      const base =
        "You are a structured-data extractor. Extract the requested data from the text and " +
        "return ONLY valid JSON — no markdown, no prose." +
        (input.instructions ? `\n\n${input.instructions}` : "");
      const run = async (reinforce: boolean) => {
        const res = await client.chat({
          system: reinforce ? `${base}\n\nYour previous output was not valid JSON. Return ONLY parseable JSON.` : base,
          prompt: input.text,
          tier: input.tier ?? "smart",
          purpose: input.purpose ?? "contract:extract",
        });
        return res;
      };
      let res = await run(false);
      try {
        return { data: input.schema.parse(parseJsonLoose(res.text)), usage: res.usage };
      } catch {
        // one retry with reinforcement
        res = await run(true);
        return { data: input.schema.parse(parseJsonLoose(res.text)), usage: res.usage };
      }
    },

    async classify(input: ClassifyInput): Promise<ClassifyResult> {
      const res = await client.chat({
        // F060 — the model must be ALLOWED to say "none of these". Without that sentence,
        // measured by trail on 444 golden examples (mistral-small-latest, temp 0): of 38
        // inputs the model refused when invited to, this prompt turned 34 into a
        // confident WRONG label inside the menu and let none through as a refusal. That
        // undid F052 from the outside — the code stopped guessing labels[0], and the
        // prompt made the model guess instead.
        //
        // It is exactly ONE sentence, the one trail measured. They isolated it: removing
        // only this sentence reproduces the failure (35 wrong vs our 34), so it is the
        // invitation to refuse that matters, not the confidence field or the wording
        // around it. Do not "tidy" it away, and do not change the words — an unmeasured
        // edit on top of a measured one makes the measurement say nothing.
        system:
          "You are a zero-shot classifier. Choose exactly one label from the provided list. " +
          CLASSIFY_ABSTAIN_SENTENCE +
          " " +
          'Return ONLY JSON: {"label": "<one of the labels>", "confidence": <0..1>}.',
        prompt: `Labels: ${JSON.stringify(input.labels)}\n\nText:\n${input.text}`,
        tier: input.tier ?? "cheap",
        purpose: input.purpose ?? "contract:classify",
      });
      // F052 — no fallback to labels[0]. "The model chose the first one" and "the model
      // named something we do not offer" were the same value, and a consumer was routing
      // an autonomy level off it. The raw answer is kept so the failure is inspectable,
      // not merely reported.
      //
      // F059 — a reply we cannot read still THROWS by default, and that stays: in
      // product use a refusal or an outage is not a classification. The catch below
      // fires only when the caller asked for a value, because they are MEASURING and a
      // throw at example 212 of 444 destroys the other 232 rather than reporting one.
      //
      // It catches BOTH ways parseJsonLoose fails — no bracket at all ("no JSON found")
      // AND a SyntaxError from JSON.parse on a truncated or malformed object. Both are
      // honestly "unparseable", and a caller counting them gets both; the type doc says
      // so, because a count that silently includes a category the docs deny is a wrong
      // number wearing a right one's clothes.
      let parsed: { label?: string; confidence?: number };
      try {
        parsed = parseJsonLoose(res.text) as { label?: string; confidence?: number };
      } catch (err) {
        if (input.onUnparseable !== "value") throw err;
        return {
          label: null,
          rawLabel: res.text.slice(0, RAW_SNIPPET_CHARS),
          confidence: null,
          outcome: "unparseable",
          usage: res.usage,
        };
      }
      const matched = matchLabel(parsed.label, input.labels);
      return {
        label: matched,
        ...(matched !== null ? {} : { rawLabel: typeof parsed.label === "string" ? parsed.label : res.text.slice(0, RAW_SNIPPET_CHARS) }),
        // 0 is a real confidence; "no confidence reported" is not 0.
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
        outcome: matched !== null ? "answered" : "out-of-set",
        usage: res.usage,
      };
    },

    async rerank(input: RerankInput): Promise<RerankResult> {
      const res = await client.chat({
        system:
          "You are a relevance reranker. Score each item 0..1 for relevance to the query and " +
          'return ONLY JSON: [{"item": "<verbatim item>", "score": <0..1>}], ordered by score desc.',
        prompt: `Query: ${input.query}\n\nItems:\n${JSON.stringify(input.items)}`,
        tier: input.tier ?? "fast",
        purpose: input.purpose ?? "contract:rerank",
      });
      const raw = parseJsonLoose(res.text) as { item?: string; score?: number }[];
      // F052 — an unreadable answer THROWS rather than returning []. `extract` in this
      // same file has always done that; rerank silently handed back an empty ranking, so
      // "nothing was relevant" and "I could not read the reply" were one value.
      if (!Array.isArray(raw)) {
        throw new Error(
          `ai.contracts.rerank: the model did not return a JSON array. ` +
            `Got: ${res.text.slice(0, RAW_SNIPPET_CHARS)}${res.text.length > RAW_SNIPPET_CHARS ? "…" : ""}`,
        );
      }
      const scored = new Map<string, number>();
      for (const r of raw) {
        // Only items the CALLER supplied — the same discipline classify applies to
        // labels. An item the model invented is not a ranking of anything.
        if (typeof r?.item !== "string" || !input.items.includes(r.item)) continue;
        if (typeof r?.score !== "number") continue;
        if (!scored.has(r.item)) scored.set(r.item, r.score);
      }
      const ranked = [...scored].map(([item, score]) => ({ item, score })).sort((a, b) => b.score - a.score);
      // What the model did NOT score, named rather than silently absent.
      const unscored = input.items.filter((i) => !scored.has(i));
      return { ranked, unscored, usage: res.usage };
    },
  };
}
