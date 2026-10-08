// F077.3 — a "-latest" override warns (once per id) and marks usage.floating, unless the
// caller says allowFloating; strictPinning turns it into an error.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createAI } from "../client.js";
import { makeOpenAICompatibleAdapter } from "../providers/openai-compatible.js";

const body = { model: "mistral-large-2512", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
const fetchOk = (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const mistral = () => makeOpenAICompatibleAdapter({ name: "mistral", baseUrl: "https://api.mistral.ai/v1", apiKey: "k", fetch: fetchOk });
const floating = { provider: "mistral", model: "mistral-large-latest", transport: "http" } as const;

let warns: string[] = [];
const realWarn = console.warn;
beforeEach(() => { warns = []; console.warn = (m: string) => { warns.push(String(m)); }; });
afterEach(() => { console.warn = realWarn; });

test("a -latest override warns ONCE per id and marks usage.floating", async () => {
  const ai = createAI({ providers: { mistral: mistral() }, costSink: null });
  const a = await ai.chat({ prompt: "x", override: floating });
  const b = await ai.chat({ prompt: "x", override: floating });
  expect(a.usage.floating).toBe(true);
  expect(b.usage.floating).toBe(true);
  expect(warns.filter((w) => w.includes("mistral:mistral-large-latest"))).toHaveLength(1);
});

test("allowFloating: no warning, no floating mark; a pinned tier never warns", async () => {
  const ai = createAI({ providers: { mistral: mistral() }, costSink: null });
  const a = await ai.chat({ prompt: "x", override: floating, allowFloating: true });
  const b = await ai.chat({ prompt: "x", tier: "smart" });
  expect(a.usage.floating).toBeUndefined();
  expect(b.usage.floating).toBeUndefined();
  expect(warns).toEqual([]);
});

test("strictPinning refuses a -latest id unless allowFloating, and names the way out", async () => {
  const ai = createAI({ providers: { mistral: mistral() }, costSink: null, strictPinning: true });
  await expect(ai.chat({ prompt: "x", override: floating })).rejects.toThrow(/strictPinning.*describeTier.*allowFloating/s);
  const ok = await ai.chat({ prompt: "x", override: floating, allowFloating: true });
  expect(ok.text).toBe("ok");
});

test("streaming marks usage.floating too", async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
  const f = (async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
  const ai = createAI({ providers: { mistral: makeOpenAICompatibleAdapter({ name: "mistral", baseUrl: "https://api.mistral.ai/v1", apiKey: "k", fetch: f }) }, costSink: null });
  let floatingSeen: boolean | undefined;
  for await (const ev of ai.chatStream({ prompt: "x", override: floating })) if (ev.type === "usage") floatingSeen = ev.usage.floating;
  expect(floatingSeen).toBe(true);
});
