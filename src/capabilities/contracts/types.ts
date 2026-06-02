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
  label: string;
  confidence: number;
  usage: Usage;
}

export interface RerankInput {
  query: string;
  items: string[];
  tier?: Tier;
  purpose?: string;
}
export interface RerankResult {
  ranked: { item: string; score: number }[];
  usage: Usage;
}

export interface Contracts {
  mockup(input: MockupInput): Promise<MockupResult>;
  design(input: DesignInput): Promise<DesignResult>;
  extract<T>(input: ExtractInput<T>): Promise<ExtractResult<T>>;
  classify(input: ClassifyInput): Promise<ClassifyResult>;
  rerank(input: RerankInput): Promise<RerankResult>;
}
