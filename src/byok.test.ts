// F069.1 — a BYOK client must never run on the fleet's env keys.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createAI } from "./client.js";
import { byokAdapter, isByokKeyed } from "./byok.js";
import { openaiAdapter } from "./providers/openai.js";

const SMART = { smart: { provider: "openai", model: "gpt-4o-mini", transport: "http" as const } };
const realFetch = globalThis.fetch;
const savedKey = process.env.OPENAI_API_KEY;
let calls: { url: string; auth?: string }[] = [];

beforeEach(() => {
  calls = [];
  process.env.OPENAI_API_KEY = "sk-FLEET";
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), auth: h.authorization ?? h.Authorization });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
});

test("byok client with an adapter built the ordinary way (apiKey undefined) throws, and nothing is sent", async () => {
  expect(() =>
    createAI({ byok: true, costSink: null, providers: { openai: openaiAdapter({ apiKey: undefined }) }, defaults: SMART }),
  ).toThrow(/not built with byokAdapter/);
  expect(calls).toHaveLength(0);
});

test("the hole this closes: without byok, a missing key DOES send the fleet's key", async () => {
  const ai = createAI({ costSink: null, providers: { openai: openaiAdapter({ apiKey: undefined }) }, defaults: SMART });
  await ai.chat({ prompt: "hej", tier: "smart" });
  expect(calls[0]?.auth).toBe("Bearer sk-FLEET");
});

test("byokAdapter refuses a missing key and a blank key", () => {
  expect(() => byokAdapter(openaiAdapter, { apiKey: undefined })).toThrow(/no customer key/);
  expect(() => byokAdapter(openaiAdapter, { apiKey: "" })).toThrow(/no customer key/);
  expect(() => byokAdapter(openaiAdapter, { apiKey: "   " })).toThrow(/no customer key/);
  expect(calls).toHaveLength(0);
});

test("byok without providers throws at setup instead of falling back to the fleet's defaults", () => {
  expect(() => createAI({ byok: true, costSink: null })).toThrow(/needs `providers`/);
  expect(() => createAI({ byok: true, costSink: null, providers: {} })).toThrow(/needs `providers`/);
});

test("a byok client with a real customer key calls with THAT key", async () => {
  const openai = byokAdapter(openaiAdapter, { apiKey: "sk-CUSTOMER" });
  expect(isByokKeyed(openai)).toBe(true);
  const ai = createAI({ byok: true, costSink: null, providers: { openai }, defaults: SMART });
  const r = await ai.chat({ prompt: "hej", tier: "smart" });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.auth).toBe("Bearer sk-CUSTOMER");
  expect(r.usage.provider).toBe("openai");
});

test("a tier the customer did not map fails closed — no call to the fleet's providers", async () => {
  const ai = createAI({
    byok: true,
    costSink: null,
    providers: { openai: byokAdapter(openaiAdapter, { apiKey: "sk-CUSTOMER" }) },
    defaults: SMART,
  });
  await expect(ai.chat({ prompt: "hej", tier: "fast" })).rejects.toThrow(/no provider adapter registered/);
  expect(calls).toHaveLength(0);
});
