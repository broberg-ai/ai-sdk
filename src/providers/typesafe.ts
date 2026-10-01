// TypeSafe adapter (F066) — Jev, a "System One" decision model. It does NOT generate
// text, so it implements ProviderAdapter.judge only; there is no chat route.
//
// One POST to /v1/systemone with a `state` and a map of typed `questions`; the answer
// comes back per question id with calibrated probabilities. Format is TypeSafe's own —
// not OpenAI- or Anthropic-compatible. Plain fetch, no vendor SDK (fleet rule).
//
// RESIDENCY: US-hosted ("The Services are hosted in the United States", TypeSafe
// privacy policy, read 2026-10-01). Zero data retention is enterprise-only, so on a
// normal key the input IS retained. They do not train on input. NOT for personal data.
//
// Key from TYPESAFE_API_KEY (Global Vault, "Typesafe AI"). Ships dark: without a key
// nothing happens until someone calls judge, and then the error names the variable.
import { DEFAULT_BASE_URLS } from "../cost/default-hosts.js";
import { regionOfHost } from "../cost/region.js";
import { freshUsage } from "../cost/usage.js";
import type {
  JudgeAnswer,
  JudgeQuestion,
  JudgeRequest,
  JudgeResult,
  ProviderAdapter,
} from "../types.js";

type WireAnswer = {
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
  confidence?: number;
};

export function typesafeAdapter(
  config: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch } = {},
): ProviderAdapter {
  const fetchImpl = config.fetch ?? fetch;
  const base = (config.baseUrl ?? DEFAULT_BASE_URLS.typesafe).replace(/\/$/, "");

  function key(): string {
    const k = config.apiKey ?? process.env.TYPESAFE_API_KEY;
    if (!k) throw new Error("typesafe adapter: API key not set (env TYPESAFE_API_KEY)");
    return k;
  }

  /** Map one wire answer onto the question we ASKED. The type comes from our own
   *  question, not from the response: the live API returns a `type` field that the
   *  documentation's example does not show, and a contract read off an undocumented
   *  field is a contract that breaks the day the docs are right. */
  function mapAnswer(id: string, q: JudgeQuestion, a: WireAnswer | undefined): JudgeAnswer {
    // A question that came back without an answer must not become `undefined` sitting
    // where an answer should be — that is a "no" arriving shaped like a "yes".
    if (!a) throw new Error(`typesafe judge: no answer returned for question "${id}"`);
    const num = (v: unknown, field: string): number => {
      if (typeof v !== "number") throw new Error(`typesafe judge: "${id}" answer has no numeric ${field}`);
      return v;
    };
    if (q.type === "noul") return { type: "noul", noul: num(a.noul, "noul") };
    if (q.type === "choice") {
      if (typeof a.choice !== "string") throw new Error(`typesafe judge: "${id}" answer has no choice`);
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

  async function judge(req: JudgeRequest): Promise<JudgeResult> {
    const apiKey = key();
    const res = await fetchImpl(`${base}/systemone`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: req.spec.model, state: req.state, questions: req.questions }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      // 429 = rate limit, 529 = overloaded (their docs). No retry here — no adapter in
      // this package retries on its own; a caller-supplied fallback is the route.
      throw new Error(`typesafe judge ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      model?: string;
      answers?: Record<string, WireAnswer>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const answers: Record<string, JudgeAnswer> = {};
    for (const [id, q] of Object.entries(req.questions)) {
      answers[id] = mapAnswer(id, q, data.answers?.[id]);
    }

    // Book the cost on the model that ANSWERED: asking for "jev-latest" comes back as
    // "jev-1.13.0". A version we have no price for is then booked "unpriced" by
    // freshUsage instead of inheriting a number nobody checked.
    return {
      answers,
      usage: freshUsage({
        provider: "typesafe",
        model: data.model ?? req.spec.model,
        region: regionOfHost(base),
        transport: "http",
        capability: "judge",
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      }),
    };
  }

  return { name: "typesafe", judge };
}
