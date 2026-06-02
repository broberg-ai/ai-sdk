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
        system:
          "You are a zero-shot classifier. Choose exactly one label from the provided list. " +
          'Return ONLY JSON: {"label": "<one of the labels>", "confidence": <0..1>}.',
        prompt: `Labels: ${JSON.stringify(input.labels)}\n\nText:\n${input.text}`,
        tier: input.tier ?? "cheap",
        purpose: input.purpose ?? "contract:classify",
      });
      const parsed = parseJsonLoose(res.text) as { label?: string; confidence?: number };
      const label = input.labels.includes(parsed.label ?? "") ? parsed.label! : (input.labels[0] ?? "");
      const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
      return { label, confidence, usage: res.usage };
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
      const ranked = (Array.isArray(raw) ? raw : [])
        .map((r) => ({ item: String(r.item ?? ""), score: typeof r.score === "number" ? r.score : 0 }))
        .sort((a, b) => b.score - a.score);
      return { ranked, usage: res.usage };
    },
  };
}
