import { expect, test } from "bun:test";
import { createAI } from "../client.js";
import { freshUsage } from "../cost/usage.js";
import { getPrice } from "../cost/pricing.js";
import type { ChatRequest, ProviderAdapter } from "../types.js";
import { getUsdToDkk, FALLBACK_USD_DKK, SECOND_OPINION_INSTRUCTION, SECOND_OPINION_PANEL, SECOND_OPINION_SYNTH, SECOND_OPINION_SYNTH_INSTRUCTION } from "./second-opinion.js";

type Seen = { provider: string; model: string; system: string; prompt: string };

function spy(name: string, seen: Seen[], opts: { fail?: boolean } = {}): ProviderAdapter {
  return {
    name,
    async chat(req: ChatRequest) {
      const system = String(req.messages.find((m) => m.role === "system")?.content ?? "");
      const prompt = String(req.messages.find((m) => m.role === "user")?.content ?? "");
      seen.push({ provider: name, model: req.spec.model, system, prompt });
      if (opts.fail) throw new Error(`${name} is down`);
      const usage = freshUsage({ provider: name, model: req.spec.model, transport: "http", capability: "chat", inputTokens: 1000, outputTokens: 500 });
      usage.costUsd = 0.01;
      return { text: `review from ${req.spec.model}`, usage };
    },
  } as ProviderAdapter;
}

function client(failing: string[] = []) {
  const seen: Seen[] = [];
  const names = ["anthropic", "openai", "gemini", "mistral", "openrouter"];
  const providers = Object.fromEntries(names.map((n) => [n, spy(n, seen, { fail: failing.includes(n) })]));
  return { ai: createAI({ providers, costSink: null }), seen };
}

test("F088 refuses without confirmNoPersonalData:true and sends nothing", async () => {
  const { ai, seen } = client();
  await expect(ai.secondOpinion({ content: "a plan" })).rejects.toThrow(/confirmNoPersonalData/);
  await expect(ai.secondOpinion({ content: "a plan", confirmNoPersonalData: false })).rejects.toThrow(/Nothing was sent/);
  expect(seen).toHaveLength(0);
});

test("F088 asks all five panel models with the same instruction and the content", async () => {
  const { ai, seen } = client();
  const r = await ai.secondOpinion({ content: "PLAN-XYZ-123", title: "T", confirmNoPersonalData: true, usdToDkk: 6.5, synthesize: false });
  const panel = seen.filter((s) => s.system.startsWith(SECOND_OPINION_INSTRUCTION));
  expect(panel.map((s) => `${s.provider}:${s.model}`).sort()).toEqual(
    SECOND_OPINION_PANEL.map((m) => `${m.provider}:${m.model}`).sort(),
  );
  for (const s of panel) expect(s.prompt).toContain("PLAN-XYZ-123");
  expect(r.opinions).toHaveLength(5);
  expect(r.opinions.every((o) => o.text?.startsWith("review from"))).toBe(true);
  expect(r.synthesis).toBeUndefined();
});

test("F088 one failing model is reported as error; the others still answer", async () => {
  const { ai } = client(["anthropic"]);
  const r = await ai.secondOpinion({ content: "a plan", confirmNoPersonalData: true, usdToDkk: 6.5, synthesize: false });
  const failed = r.opinions.find((o) => o.provider === "anthropic")!;
  expect(failed.error).toContain("anthropic is down");
  expect(failed.text).toBeUndefined();
  expect(r.opinions.filter((o) => o.text)).toHaveLength(4);
  expect(r.markdown).toContain("_Fejl:");
});

test("F088 synthesis condenses the answered reviews; total cost sums every call", async () => {
  const { ai, seen } = client(["gemini"]);
  const r = await ai.secondOpinion({ content: "a plan", confirmNoPersonalData: true, usdToDkk: 6.5, synthesize: true });
  const synth = seen.filter((s) => s.system.startsWith(SECOND_OPINION_SYNTH_INSTRUCTION));
  expect(synth).toHaveLength(1);
  expect(synth[0]!.model).toBe(SECOND_OPINION_SYNTH.model);
  expect(synth[0]!.prompt).toContain("review from claude-opus-5-5");
  expect(synth[0]!.prompt).not.toContain("gemini-4-argon"); // failed reviewer is not passed on
  expect(r.synthesis?.text).toBe(`review from ${SECOND_OPINION_SYNTH.model}`);
  const expected = r.opinions.reduce((n, o) => n + (o.usage?.costUsd ?? 0), 0) + (r.synthesis?.usage?.costUsd ?? 0);
  expect(r.totalCostUsd).toBeCloseTo(expected, 10);
  expect(r.totalCostUsd).toBeCloseTo(0.05, 10); // 4 answered + 1 synthesis × $0.01
});

test("F088 every call is told the output language; Danish by default", async () => {
  const { ai, seen } = client();
  await ai.secondOpinion({ content: "a plan", confirmNoPersonalData: true, usdToDkk: 6.5, synthesize: true });
  expect(seen).toHaveLength(6);
  expect(seen.every((s) => s.system.endsWith("Write your entire answer in Danish."))).toBe(true);
  const en = client();
  await en.ai.secondOpinion({ content: "a plan", confirmNoPersonalData: true, usdToDkk: 6.5, language: "English", synthesize: false });
  expect(en.seen.every((s) => s.system.endsWith("in English."))).toBe(true);
});

test("F088 refuses material that carries a credential, naming the kind not the value", async () => {
  const { ai, seen } = client();
  const key = "sk-" + "a".repeat(40);
  const err = await ai.secondOpinion({ content: `config: ${key}`, confirmNoPersonalData: true, usdToDkk: 6.5 }).then(() => new Error("did not throw"), (e: Error) => e);
  expect(err.message).toContain("credential");
  expect(err.message).not.toContain(key);
  await expect(ai.secondOpinion({ content: "-----BEGIN RSA PRIVATE KEY-----\nx", confirmNoPersonalData: true, usdToDkk: 6.5 })).rejects.toThrow(/private key/);
  expect(seen).toHaveLength(0);
});

test("F088.2 the two new panel models are priced", () => {
  expect(getPrice("gemini", "gemini-4-argon")).toMatchObject({ inputPer1M: 2, outputPer1M: 10 });
  expect(getPrice("openrouter", "openai/gpt-6-astra")).toMatchObject({ inputPer1M: 10, outputPer1M: 50 });
  expect(getPrice("openrouter", "openai/gpt-6.1-sol")).toMatchObject({ inputPer1M: 2, outputPer1M: 10 });
  expect(getPrice("openrouter", "deepseek/deepseek-v4.1-flash-1017")).toMatchObject({ inputPer1M: 0.15, outputPer1M: 0.6 });
});

test("F088 no summary by default (owner 2026-11-05: No to a Mistral summary)", async () => {
  const { ai, seen } = client();
  const r = await ai.secondOpinion({ content: "a plan", confirmNoPersonalData: true, usdToDkk: 6.5 });
  expect(seen).toHaveLength(5);
  expect(r.synthesis).toBeUndefined();
  expect(r.markdown).not.toContain("## Opsummering");
});

test("F088 the full reviews stay in the result and the report even when a summary is asked for", async () => {
  const { ai } = client();
  const r = await ai.secondOpinion({ content: "a plan", confirmNoPersonalData: true, usdToDkk: 6.5, synthesize: true });
  expect(r.synthesis?.text).toBeDefined();
  expect(r.opinions.filter((o) => o.text)).toHaveLength(5);
  for (const o of r.opinions) {
    expect(r.markdown).toContain(`## ${o.label}`);
    expect(r.markdown).toContain(o.text!);
  }
});

test("F088 the price is always returned in USD and DKK, and printed in the report", async () => {
  const { ai } = client();
  const r = await ai.secondOpinion({ content: "a plan", confirmNoPersonalData: true, usdToDkk: 6.5 });
  expect(r.cost.usd).toBeCloseTo(0.05, 10);
  expect(r.cost.dkk).toBeCloseTo(0.325, 10);
  expect(r.cost.rateSource).toBe("given");
  expect(r.markdown).toContain("$0.0500 ≈ 0,33 kr.");
});

test("F088 USD to DKK: ECB rate when the fetch works, labelled fallback when it does not", async () => {
  const ok = (async () => new Response(JSON.stringify({ date: "2026-11-04", rates: { DKK: 6.6334 } }))) as unknown as typeof fetch;
  expect(await getUsdToDkk(ok)).toEqual({ rate: 6.6334, date: "2026-11-04", source: "ecb" });
  const down = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
  expect(await getUsdToDkk(down)).toEqual({ rate: FALLBACK_USD_DKK.rate, date: FALLBACK_USD_DKK.date, source: "fallback" });
  const junk = (async () => new Response(JSON.stringify({ rates: {} }))) as unknown as typeof fetch;
  expect((await getUsdToDkk(junk)).source).toBe("fallback");
});
