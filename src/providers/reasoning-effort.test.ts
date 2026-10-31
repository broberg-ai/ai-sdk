// F074.3 — reasoningEffort reaches Mistral's `reasoning_effort`, and Large 4 does not
// think by default. Measured 2026-10-08: thinking on = ~40x price, ~10x latency.
import { expect, test } from "bun:test";
import { createAI } from "../client.js";
import { mistralAdapter } from "./mistral.js";
import { buildChatBody } from "./openai-compatible.js";

const MISTRAL = { name: "mistral", supportsReasoningEffort: true } as const;
const req = (model: string, reasoningEffort?: "none" | "low" | "medium" | "high") =>
  ({ messages: [{ role: "user", content: "q" }], spec: { provider: "mistral", model, transport: "http" }, reasoningEffort }) as never;

test("Large 4 gets reasoning_effort 'low' when the caller says nothing (F085.5 — Mistral refuses 'none' since 2026-10-29)", () => {
  expect(buildChatBody(req("mistral-large-4"), MISTRAL).reasoning_effort).toBe("low");
  expect(buildChatBody(req("mistral-large-4-0"), MISTRAL).reasoning_effort).toBe("low");
});

test("an explicit 'high' wins over the default", () => {
  expect(buildChatBody(req("mistral-large-4", "high"), MISTRAL).reasoning_effort).toBe("high");
});

test("Large 3 / -latest carry NO reasoning_effort by default (Mistral rejects it there)", () => {
  // Negative control: measured 2026-10-08, mistral-large-2512 answers
  // "reasoning_effort is not enabled for this model" to any value.
  for (const m of ["mistral-large-latest", "mistral-large-2512", "mistral-small-latest"]) {
    expect(buildChatBody(req(m), MISTRAL)).not.toHaveProperty("reasoning_effort");
  }
});

test("a provider without the option REFUSES reasoningEffort rather than dropping it", () => {
  expect(() => buildChatBody(req("gpt-x", "none"), { name: "openai" })).toThrow(/reasoningEffort/);
  // …and says nothing when it was not asked for.
  expect(buildChatBody(req("gpt-x"), { name: "openai" })).not.toHaveProperty("reasoning_effort");
});

test("end to end: ai.chat and ai.chatStream put it on the wire", async () => {
  const bodies: Record<string, unknown>[] = [];
  const f = (async (_url: string | URL, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    bodies.push(b);
    if (b.stream) {
      const sse =
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ model: b.model, choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  }) as typeof fetch;
  const ai = createAI({ providers: { mistral: mistralAdapter({ apiKey: "k", fetch: f }) }, costSink: null });
  const override = { provider: "mistral", model: "mistral-large-4", transport: "http" } as const;

  await ai.chat({ prompt: "x", override });
  await ai.chat({ prompt: "x", override, reasoningEffort: "high" });
  for await (const _ of ai.chatStream({ prompt: "x", override })) { /* drain */ }
  // "high" on the stream too: the default alone would pass even if chatStream dropped the field.
  for await (const _ of ai.chatStream({ prompt: "x", override, reasoningEffort: "high" })) { /* drain */ }

  expect(bodies.map((b) => b.reasoning_effort)).toEqual(["low", "high", "low", "high"]);

  // F085.5 — ai.vision forwards it too (jam: vision dropped it, so 'high' still sent the default).
  bodies.length = 0;
  await ai.vision({ image: "https://x/a.png", prompt: "x", override });
  await ai.vision({ image: "https://x/a.png", prompt: "x", override, reasoningEffort: "medium" });
  expect(bodies.map((b) => b.reasoning_effort)).toEqual(["low", "medium"]);
});

test("ai.vision forwards maxTokens and temperature (F087 — Anthropic otherwise stops at 1024)", async () => {
  const bodies: Record<string, unknown>[] = [];
  const f = (async (_url: string | URL, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    bodies.push(b);
    return new Response(JSON.stringify({ model: b.model, choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  }) as typeof fetch;
  const ai = createAI({ providers: { mistral: mistralAdapter({ apiKey: "k", fetch: f }) }, costSink: null });
  await ai.vision({ image: "https://x/a.png", prompt: "x", override: { provider: "mistral", model: "mistral-medium-2604" }, maxTokens: 16000, temperature: 0.2 });
  expect(bodies[0]!.max_tokens).toBe(16000);
  expect(bodies[0]!.temperature).toBe(0.2);
});
