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
   *  absence IS the signal. */
  label: string | null;
  /** The model's own answer when it did not match, so a caller can log or route what
   *  actually came back instead of only knowing that something did not. */
  rawLabel?: string;
  /** `null` when the model reported no confidence. `0` is a REAL confidence and stays
   *  `0` — the two used to be the same number, which made the field unusable as a
   *  signal even for a caller who wanted to check it. */
  confidence: number | null;
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
