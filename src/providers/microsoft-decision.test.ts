import { afterEach, expect, test } from "bun:test";
import { microsoftDecisionAdapter } from "./microsoft-decision.js";
import { createAI } from "../client.js";
import { byokAdapter } from "../byok.js";
import type { JudgeQuestion } from "../types.js";

// The raw answer measured live from decision-1-eu on 2026-10-26 (trimmed).
const LIVE = {
  model: "microsoft-decision-1",
  answers: {
    refund: { noul: 0.9995, type: "noul" },
    team: { choice: "shipping", confidence: 0.36, probabilities: { billing: 0.39, shipping: 0.57, tech: 0.03 }, type: "choice" },
    urgency: { score: 0.92, confidence: 0.66, probabilities: { "0": 0.15, "1": 0.78, "2": 0.07 }, legend: { "0": "low", "1": "mid", "2": "high" }, type: "score" },
  },
  usage: { input_tokens: 104, output_tokens: 3 },
};
const QUESTIONS: Record<string, JudgeQuestion> = {
  refund: { type: "noul", instructions: "Refund?", criteria: { true: "yes", false: "no" } },
  team: { type: "choice", instructions: "Team", criteria: { billing: "B", shipping: "S", tech: "T" } },
  urgency: { type: "score", instructions: "Urgency", criteria: ["low", "mid", "high"] },
};
const spec = { provider: "microsoft-decision", model: "microsoft-decision-1-v1", transport: "http" as const };

function azureFetch(body: unknown = LIVE, headers: Record<string, string> = { "x-ms-region": "Sweden Central" }) {
  const seen: { url: string; apiKey: string | null; body: any }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), apiKey: new Headers(init!.headers).get("api-key"), body: JSON.parse(String(init!.body)) });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
  }) as unknown as typeof fetch;
  return { f, seen };
}

const ENV = ["AZURE_DECISION_ENDPOINT", "AZURE_DECISION_API_KEY", "AZURE_DECISION_DEPLOYMENT", "AI_JUDGE_PROVIDER"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

test("posts state+questions to /providers/microsoft/v1/systemone with the DEPLOYMENT as model (F081.2)", async () => {
  const { f, seen } = azureFetch();
  await microsoftDecisionAdapter({ endpoint: "https://acme.cognitiveservices.azure.com/", apiKey: "k", deployment: "dep-x", fetch: f })
    .judge!({ state: "s", questions: QUESTIONS, spec });
  expect(seen[0]!.url).toBe("https://acme.cognitiveservices.azure.com/providers/microsoft/v1/systemone");
  expect(seen[0]!.apiKey).toBe("k");
  expect(seen[0]!.body).toEqual({ model: "dep-x", state: "s", questions: QUESTIONS });
});

test("the live answer maps to the same JudgeResult shape as Jev (F081.2)", async () => {
  const { f } = azureFetch();
  const r = await microsoftDecisionAdapter({ endpoint: "https://e", apiKey: "k", fetch: f }).judge!({ state: "s", questions: QUESTIONS, spec });
  expect(r.answers.refund).toEqual({ type: "noul", noul: 0.9995 });
  expect(r.answers.team).toEqual({ type: "choice", choice: "shipping", probabilities: { billing: 0.39, shipping: 0.57, tech: 0.03 }, confidence: 0.36 });
  expect(r.answers.urgency).toEqual({ type: "score", score: 0.92, probabilities: { "0": 0.15, "1": 0.78, "2": 0.07 }, legend: { "0": "low", "1": "mid", "2": "high" }, confidence: 0.66 });
  expect(r.usage.inputTokens).toBe(104);
  expect(r.usage.costUsd).toBeCloseTo((107 / 1e6) * 0.042, 12);
  expect(r.usage.costBasis).toBe("computed");
});

test("a missing answer throws instead of arriving as undefined (F081.2)", async () => {
  const { f } = azureFetch({ ...LIVE, answers: { refund: LIVE.answers.refund } });
  await expect(microsoftDecisionAdapter({ endpoint: "https://e", apiKey: "k", fetch: f }).judge!({ state: "s", questions: QUESTIONS, spec }))
    .rejects.toThrow(/no answer returned for question "team"/);
});

test("BYOK: explicit endpoint+key win over env (F081.2)", async () => {
  process.env.AZURE_DECISION_ENDPOINT = "https://fleet.cognitiveservices.azure.com";
  process.env.AZURE_DECISION_API_KEY = "fleet-key";
  const { f, seen } = azureFetch();
  await microsoftDecisionAdapter({ endpoint: "https://customer.cognitiveservices.azure.com", apiKey: "customer-key", fetch: f })
    .judge!({ state: "s", questions: QUESTIONS, spec });
  expect(seen[0]!.url.startsWith("https://customer.")).toBe(true);
  expect(seen[0]!.apiKey).toBe("customer-key");
});

test("an explicit key without its own endpoint is refused — never the fleet endpoint with a caller's key (F081.2)", async () => {
  process.env.AZURE_DECISION_ENDPOINT = "https://fleet.cognitiveservices.azure.com";
  const { f, seen } = azureFetch();
  await expect(microsoftDecisionAdapter({ apiKey: "customer-key", fetch: f }).judge!({ state: "s", questions: QUESTIONS, spec }))
    .rejects.toThrow(/explicit apiKey needs its own endpoint/);
  expect(seen.length).toBe(0);
});

test("ships dark: no env → the error names the variables; constructing it does nothing (F081.2)", async () => {
  delete process.env.AZURE_DECISION_ENDPOINT;
  delete process.env.AZURE_DECISION_API_KEY;
  const a = microsoftDecisionAdapter({ fetch: azureFetch().f });
  await expect(a.judge!({ state: "s", questions: QUESTIONS, spec })).rejects.toThrow(/AZURE_DECISION_ENDPOINT/);
  process.env.AZURE_DECISION_ENDPOINT = "https://e";
  await expect(a.judge!({ state: "s", questions: QUESTIONS, spec })).rejects.toThrow(/AZURE_DECISION_API_KEY/);
});

test("usage.region is read off the x-ms-region header; without it, unknown — never an assumed eu (F081.3)", async () => {
  const eu = await microsoftDecisionAdapter({ endpoint: "https://e", apiKey: "k", fetch: azureFetch().f }).judge!({ state: "s", questions: QUESTIONS, spec });
  expect(eu.usage.region).toBe("eu");
  const none = await microsoftDecisionAdapter({ endpoint: "https://e", apiKey: "k", fetch: azureFetch(LIVE, {}).f }).judge!({ state: "s", questions: QUESTIONS, spec });
  expect(none.usage.region).toBe("unknown");
  const us = await microsoftDecisionAdapter({ endpoint: "https://e", apiKey: "k", fetch: azureFetch(LIVE, { "x-ms-region": "East US" }).f }).judge!({ state: "s", questions: QUESTIONS, spec });
  expect(us.usage.region).toBe("us");
});

test("AI_JUDGE_PROVIDER=microsoft-decision routes ai.judge to Decision-1 without an override; unset stays on Jev (F081.3)", async () => {
  const { f } = azureFetch();
  const ms = microsoftDecisionAdapter({ endpoint: "https://e", apiKey: "k", fetch: f });
  const ts = { name: "typesafe", judge: async () => ({ answers: {}, usage: { provider: "typesafe" } as any }) };
  process.env.AI_JUDGE_PROVIDER = "microsoft-decision";
  const r = await createAI({ providers: { "microsoft-decision": ms, typesafe: ts }, costSink: null }).judge({ state: "s", questions: QUESTIONS });
  expect(r.usage.provider).toBe("microsoft-decision");
  expect(r.usage.model).toBe("microsoft-decision-1-v1");
  delete process.env.AI_JUDGE_PROVIDER;
  const j = await createAI({ providers: { "microsoft-decision": ms, typesafe: ts }, costSink: null }).judge({ state: "s", questions: QUESTIONS });
  expect(j.usage.provider).toBe("typesafe");
});

test("an unknown AI_JUDGE_PROVIDER fails closed at createAI and names the valid routes (F081.3)", () => {
  process.env.AI_JUDGE_PROVIDER = "mircosoft";
  expect(() => createAI({ costSink: null })).toThrow(/typesafe or microsoft-decision/);
});

test("the documented BYOK form works: createAI({ byok:true }) with byokAdapter(microsoftDecisionAdapter, …) (F081.2)", async () => {
  process.env.AZURE_DECISION_API_KEY = "fleet-key";
  const { f, seen } = azureFetch();
  const ai = createAI({
    byok: true,
    costSink: null,
    providers: { "microsoft-decision": byokAdapter(microsoftDecisionAdapter, { endpoint: "https://customer.cognitiveservices.azure.com", apiKey: "customer-key", deployment: "their-dep", fetch: f }) },
  });
  await ai.judge({ state: "s", questions: QUESTIONS, override: { provider: "microsoft-decision", model: "microsoft-decision-1-v1" } });
  expect(seen[0]!.apiKey).toBe("customer-key");
  expect(seen[0]!.body.model).toBe("their-dep");
});
