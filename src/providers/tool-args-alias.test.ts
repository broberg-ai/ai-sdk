// F043 — a tool call handed back to us may spell its arguments either way.
// @broberg/chat uses `args` throughout; we emit `arguments`. cms bridges the two and
// took a production outage when a rename living in a workaround was deleted with the
// workaround. We accept both rather than ask every bridging consumer to remember.
import { expect, test } from "bun:test";
import { toolCallArgs } from "./tools.js";
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";

test("reads our own spelling", () => {
  expect(toolCallArgs({ id: "1", name: "f", arguments: { a: 1 } })).toEqual({ a: 1 });
});

test("reads @broberg/chat's spelling", () => {
  expect(toolCallArgs({ id: "1", name: "f", args: { a: 1 } })).toEqual({ a: 1 });
});

test("arguments wins when a caller sets both", () => {
  expect(toolCallArgs({ id: "1", name: "f", arguments: { a: 1 }, args: { a: 2 } })).toEqual({ a: 1 });
});

test("neither set is an empty object, not a crash", () => {
  // A missing value must look like a missing value — the failure family that bit the
  // fleet three times in one day.
  expect(() => toolCallArgs({ id: "1", name: "f" })).not.toThrow();
  expect(toolCallArgs({ id: "1", name: "f" })).toEqual({});
});

test("end to end: a message history using `args` reaches the provider intact", async () => {
  let sent: Record<string, unknown> | undefined;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  try {
    const adapter = makeOpenAICompatibleAdapter({ name: "mistral", baseUrl: "https://m.test/v1", apiKey: "k" });
    await adapter.chat!({
      spec: { provider: "mistral", model: "mistral-small-latest", transport: "http" },
      messages: [
        { role: "user", content: "weather?" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "getWeather", args: { city: "Aalborg" } }] },
        { role: "tool", content: "12C", toolCallId: "c1" },
      ],
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  const msgs = sent!.messages as { tool_calls?: { function: { arguments: string } }[] }[];
  const call = msgs.find((m) => m.tool_calls)?.tool_calls?.[0];
  // Strict equality on the serialised payload: "contains" would pass on "{}" too.
  expect(call!.function.arguments).toBe('{"city":"Aalborg"}');
});

// THE TEST THAT WAS MISSING. The original "end to end" test called the adapter
// directly and never touched chatInputSchema — so it passed while the public facade
// still rejected `args` with the exact error we had told consumers was fixed. A test
// that exercises the one path nobody uses proves nothing about the path everyone uses.
test("the PUBLIC facade accepts `args` — validation, not just the adapter", async () => {
  const { chatInputSchema } = await import("../schema/inputs.js");
  const hist = (tc: unknown) => ({
    messages: [
      { role: "user", content: "x" },
      { role: "assistant", content: "", toolCalls: [tc] },
    ],
  });

  expect(() => chatInputSchema.parse(hist({ id: "c1", name: "f", args: { a: 1 } }))).not.toThrow();
  expect(() => chatInputSchema.parse(hist({ id: "c1", name: "f", arguments: { a: 1 } }))).not.toThrow();

  // Zod STRIPS unknown keys, so declaring `arguments` optional alone would have
  // dropped `args` silently. Assert the value SURVIVES parsing, not merely that
  // parsing succeeded — that distinction is the whole bug.
  const parsed = chatInputSchema.parse(hist({ id: "c1", name: "f", args: { city: "Aalborg" } }));
  const tc = (parsed.messages![1] as { toolCalls: { args?: Record<string, unknown> }[] }).toolCalls[0];
  expect(tc!.args).toEqual({ city: "Aalborg" });

  // A tool call with NEITHER spelling is still a malformed tool call.
  expect(() => chatInputSchema.parse(hist({ id: "c1", name: "f" }))).toThrow();
});
