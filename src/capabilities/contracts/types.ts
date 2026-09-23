// Prompt-contract capability types (F5.5). These layer on chat/vision with a
// fixed system prompt + (for extract) Zod output validation, so budget + cost
// tracking apply uniformly. Exposed as ai.contracts.*.
import type { z } from "zod";
import type { Usage, Tier } from "../../types.js";

export interface MockupInput {
  description: string;
  constraints?: string;
  tier?: Tier;
  purpose?: string;
}
export interface MockupResult {
  html: string;
  usage: Usage;
}

export interface DesignInput {
  /** Screenshot URL or raw bytes to iterate on. */
  screenshot: string | Uint8Array;
  instructions: string;
  tier?: Tier;
  purpose?: string;
}
export interface DesignResult {
  html: string;
  usage: Usage;
}

export interface ExtractInput<T> {
  text: string;
  /** Zod schema the extracted data must satisfy. */
  schema: z.ZodType<T>;
  instructions?: string;
  tier?: Tier;
  purpose?: string;
}
export interface ExtractResult<T> {
  data: T;
  usage: Usage;
}

export interface ClassifyInput {
  text: string;
  labels: string[];
  tier?: Tier;
  purpose?: string;
  /** What to do when the model's reply contains no JSON at all (F059).
   *
   *  `"throw"` (the DEFAULT, and unchanged) is right in product use: a refusal or an
   *  outage is not a classification, and a throw is the loudest honest answer.
   *
   *  `"value"` is for MEASURING. Requested by trail with the measurement behind it:
   *  over 444 golden examples in one batch, a throw at example 212 is not informative,
   *  it is destructive — the 232 that were never measured afterwards look like they
   *  did not exist. Their alternative was to wrap every call in try/catch and count
   *  the throws, which is this field built by hand, worse.
   *
   *  Opt-in on purpose: the caller who sets it is the caller who is reading for it. */
  onUnparseable?: "throw" | "value";
}
export interface ClassifyResult {
  /** The chosen label, or `null` when the model named a label that is not in `labels`
   *  (F052).
   *
   *  MEASURED, not taken from the report: a reply with no JSON in it at all already
   *  THREW (`parseJsonLoose`), and still does. So the silent fallback only ever fired on
   *  a *parseable* answer naming an unknown label — a narrower hole than reported, and
   *  the more dangerous half, because that answer looks like a real classification.
   *
   *  Until 0.41.1 this fell back to `labels[0]`, so "the model chose the first one" and
   *  "the model could not answer" were the SAME VALUE at the call site. helpdesk routes
   *  an autonomy level off this field — an unclassifiable ticket therefore landed on the
   *  tenant's first intent, chosen by the order of a config array, with no error and no
   *  log trace. `null` is the whole fix: there is no field to hardcode, because the
   *  absence IS the signal.
   *
   *  **Expect `null` routinely since F060 (23 September 2026)** — the prompt now
   *  explicitly lets the model say none of the labels fit. Before that it could not,
   *  and trail measured the cost: 34 of 38 honest refusals came back as confident
   *  WRONG labels. How OFTEN `null` now occurs under this exact prompt is not yet
   *  measured (F060.2) — expect it to be common, not rare. If you route anything
   *  automatic off this field, send `null` to a human. */
  label: string | null;
  /** The model's own answer when it did not match, so a caller can log or route what
   *  actually came back instead of only knowing that something did not.
   *
   *  **It can contain RAW model output** — on the `unparseable` path it always does
   *  (the first 200 characters of the reply), and on `out-of-set` it does whenever the
   *  reply had no usable `label` string. A model that echoes part of your prompt can
   *  therefore put part of YOUR INPUT here. On a path carrying personal or health data,
   *  treat this field with the same care as the input before you log it. */
  rawLabel?: string;
  /** `null` when the model reported no confidence. `0` is a REAL confidence and stays
   *  `0` — the two used to be the same number, which made the field unusable as a
   *  signal even for a caller who wanted to check it. */
  confidence: number | null;
  /** WHICH of the three things happened, as a value you must read rather than a shape
   *  you might infer (F059).
   *
   *  `"answered"`     the model named a label from `labels`; `label` is it.
   *  `"out-of-set"`   it named something else; `label` is null, `rawLabel` is its answer.
   *  `"unparseable"`  we could not read the reply. Only reachable with
   *                   `onUnparseable: "value"` — the default still throws. It covers
   *                   BOTH ways parsing fails: no JSON in the reply at all, AND JSON
   *                   that is present but malformed or truncated. Said explicitly
   *                   because you are going to COUNT this, and a count that quietly
   *                   includes a category the docs deny is a wrong number that reads
   *                   as a right one.
   *
   *  It is NOT decoration. Once the throw is optional, `out-of-set` and `unparseable`
   *  both yield `label: null` with `rawLabel` set, so without this field they cannot be
   *  told apart — and telling them apart ("got it wrong" vs "did not answer" vs "could
   *  not be read") is the whole reason the flag was asked for.
   *
   *  The form is components' argument, not ours: a boolean like `fallbackUsed` can be
   *  destructured away as easily as a `confidence` field can be ignored, while a value
   *  you must read to proceed cannot. `answered` ⟺ `label !== null`.
   *
   *  REQUIRED, not optional — additive for anyone READING a result, a compile fix for
   *  anyone CONSTRUCTING one (a test stub or mock of `classify`). Saying it rather than
   *  calling the change "purely additive": this package has shipped that exact
   *  over-claim before, about `toolCall.arguments`, and it was wrong then. */
  outcome: "answered" | "out-of-set" | "unparseable";
  usage: Usage;
}

export interface RerankInput {
  query: string;
  items: string[];
  tier?: Tier;
  purpose?: string;
}
export interface RerankResult {
  /** Every entry is an item FROM `input.items` with a real numeric score. Items the
   *  model invented are dropped; items it failed to score are named in `unscored`. */
  ranked: { item: string; score: number }[];
  /** Input items the model returned no usable score for. Empty on a clean answer.
   *
   *  Not an error — but a caller treating `ranked` as complete must look here (F052).
   *  A missing item used to become `""` with score `0`, i.e. a plausible-looking entry
   *  ranked last. */
  unscored: string[];
  usage: Usage;
}

export interface Contracts {
  mockup(input: MockupInput): Promise<MockupResult>;
  design(input: DesignInput): Promise<DesignResult>;
  extract<T>(input: ExtractInput<T>): Promise<ExtractResult<T>>;
  classify(input: ClassifyInput): Promise<ClassifyResult>;
  rerank(input: RerankInput): Promise<RerankResult>;
}
