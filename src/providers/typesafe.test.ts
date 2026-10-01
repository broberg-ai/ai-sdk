// F066 — TypeSafe Jev through ai.judge. Every test drives the real adapter (and, where
// it matters, the real client) through an injected fetch; the live call is verified
// separately against the vault key, not here, so the suite needs no network.
import { expect, test } from "bun:test";
import { typesafeAdapter } from "./typesafe.js";
import { createAI } from "../client.js";
import { regionOfHost } from "../cost/region.js";
import { resolveModel } from "../availability/resolve.js";
import type { JudgeQuestion } from "../types.js";

const QUESTIONS: Record<string, JudgeQuestion> = {
  team: { type: "choice", instructions: "Which team", criteria: { billing: "Money", technical: "Bugs" } },
  urgent: { type: "noul", instructions: "Is it urgent" },
  mood: { type: "score", instructions: "How upset", criteria: ["Calm", "Upset", "Furious"] },
};

/** The shape the LIVE api returned on 2026-10-01 — including the per-answer `type`
 *  field that TypeSafe's documented example does not show. */
const LIVE_LIKE = {
  model: "jev-1.13.0",
  answers: {
    team: { type: "choice", choice: "technical", confidence: 0.99, probabilities: { billing: 0, technical: 1 } },
    urgent: { type: "noul", noul: 0.98 },
    mood: { type: "score", score: 1, confidence: 1, legend: { "0": "Calm", "1": "Upset", "2": "Furious" }, probabilities: { "0": 0, "1": 1, "2": 0 } },
  },
  usage: { input_tokens: 1_000_000, output_tokens: 73 },
};

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const spec = { provider: "typesafe", model: "jev-latest", transport: "http" as const };

test("F066: sends the documented wire format to /v1/systemone with a Bearer key", async () => {
  const { calls, fetchImpl } = fakeFetch(LIVE_LIKE);
  await typesafeAdapter({ apiKey: "k-1", fetch: fetchImpl }).judge!({ state: "s", questions: QUESTIONS, spec });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://api.typesafe.ai/v1/systemone");
  expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k-1");
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ model: "jev-latest", state: "s", questions: QUESTIONS });
});

test("F066: maps all three answer types, typed from the QUESTION we asked", async () => {
  const { fetchImpl } = fakeFetch(LIVE_LIKE);
  const r = await typesafeAdapter({ apiKey: "k", fetch: fetchImpl }).judge!({ state: "s", questions: QUESTIONS, spec });
  expect(r.answers).toEqual({
    team: { type: "choice", choice: "technical", probabilities: { billing: 0, technical: 1 }, confidence: 0.99 },
    urgent: { type: "noul", noul: 0.98 },
    mood: { type: "score", score: 1, probabilities: { "0": 0, "1": 1, "2": 0 }, legend: { "0": "Calm", "1": "Upset", "2": "Furious" }, confidence: 1 },
  });

  // And it does NOT depend on the undocumented `type` field: strip it, same result.
  const stripped = structuredClone(LIVE_LIKE) as { answers: Record<string, Record<string, unknown>> };
  for (const a of Object.values(stripped.answers)) delete a.type;
  const r2 = await typesafeAdapter({ apiKey: "k", fetch: fakeFetch(stripped).fetchImpl }).judge!({ state: "s", questions: QUESTIONS, spec });
  expect(r2.answers).toEqual(r.answers);
});

test("F066: a question that comes back without an answer THROWS — it does not become undefined", async () => {
  const missing = structuredClone(LIVE_LIKE) as { answers: Record<string, unknown> };
  delete missing.answers.urgent;
  await expect(
    typesafeAdapter({ apiKey: "k", fetch: fakeFetch(missing).fetchImpl }).judge!({ state: "s", questions: QUESTIONS, spec }),
  ).rejects.toThrow('no answer returned for question "urgent"');
});

test("F066: usage — region us, cost on the model that ANSWERED, unpriced for an unknown version", async () => {
  const r = await typesafeAdapter({ apiKey: "k", fetch: fakeFetch(LIVE_LIKE).fetchImpl }).judge!({ state: "s", questions: QUESTIONS, spec });
  expect(r.usage.region).toBe("us");
  expect(r.usage.model).toBe("jev-1.13.0"); // asked for jev-latest
  expect(r.usage.costUsd).toBeCloseTo(0.042, 12); // 1M input × $0.042, output free
  expect(r.usage.costBasis).toBe("computed");

  // A version we have never priced: booked as unpriced, never a $0 that looks measured.
  const future = { ...LIVE_LIKE, model: "jev-1.14.0" };
  const r2 = await typesafeAdapter({ apiKey: "k", fetch: fakeFetch(future).fetchImpl }).judge!({ state: "s", questions: QUESTIONS, spec });
  expect(r2.usage.costUsd).toBe(0);
  expect(r2.usage.costBasis).toBe("unpriced");
});

test("F066: residency is read as US, never off the Copenhagen CDN edge", () => {
  expect(regionOfHost("api.typesafe.ai")).toBe("us");
  expect(regionOfHost("https://api.typesafe.ai/v1")).toBe("us");
});

test("F066: ships dark — createAI works without a key, judge fails naming the variable", async () => {
  const prev = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    const ai = createAI({ costSink: null }); // must not throw
    await expect(ai.judge({ state: "s", questions: QUESTIONS })).rejects.toThrow("TYPESAFE_API_KEY");
  } finally {
    if (prev !== undefined) process.env.TYPESAFE_API_KEY = prev;
  }
});

test("F066: malformed questions are refused at the boundary, before anything is sent", async () => {
  const { calls, fetchImpl } = fakeFetch(LIVE_LIKE);
  const ai = createAI({ costSink: null, providers: { typesafe: typesafeAdapter({ apiKey: "k", fetch: fetchImpl }) } });
  const bad: unknown[] = [
    { state: "s", questions: {} }, // no questions
    { state: "s", questions: { q: { type: "choice", instructions: "x" } } }, // choice without criteria
    { state: "s", questions: { q: { type: "choice", instructions: "x", criteria: { only: "one" } } } }, // 1 option
    { state: "s", questions: { q: { type: "score", instructions: "x", criteria: ["one level"] } } }, // <2 levels
    { state: "s", questions: { q: { type: "maybe", instructions: "x" } } }, // unknown type
  ];
  for (const input of bad) {
    // The error class is the point: a ZodError from the schema, not a TypeSafe 4xx.
    await expect(ai.judge(input as never)).rejects.toMatchObject({ name: "ZodError" });
  }
  expect(calls).toHaveLength(0);
});

test("F066: a gating consumer can reach both Jev ids", () => {
  for (const id of ["jev-1.13.0", "jev-latest"]) {
    const r = resolveModel(id, { requireKnown: true });
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("typesafe");
  }
  // jev-latest is NOT folded into jev-1.13.0 — it moves when they release.
  expect(resolveModel("jev-latest").model).toBe("jev-latest");
});
