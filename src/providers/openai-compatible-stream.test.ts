import { expect, test } from "bun:test";
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import type { ChatStreamEvent } from "../types.js";

/** Fake fetch returning the given SSE lines as the streamed body. */
function sseFetch(lines: string[]): typeof fetch {
  return (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const l of lines) controller.enqueue(enc.encode(l));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

const spec = { provider: "openrouter", model: "google/gemini-2.5-flash", transport: "http" as const };

async function run(lines: string[]): Promise<ChatStreamEvent[]> {
  const adapter = makeOpenAICompatibleAdapter({
    name: "openrouter",
    baseUrl: "https://openrouter.test/api/v1",
    apiKey: "test-key",
    fetch: sseFetch(lines),
  });
  const out: ChatStreamEvent[] = [];
  for await (const ev of adapter.chatStream!({ messages: [{ role: "user", content: "hi" }], spec })) {
    out.push(ev);
  }
  return out;
}

test("streams text deltas, usage, then finish", async () => {
  const events = await run([
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
    "data: [DONE]\n\n",
  ]);
  expect(events.map((e) => e.type)).toEqual(["text", "text", "usage", "finish"]);
  const text = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
  expect(text).toBe("Hello");
  const finish = events.find((e) => e.type === "finish") as { reason: string };
  expect(finish.reason).toBe("stop");
});

test("accumulates a tool_call across delta fragments and emits it complete", async () => {
  const events = await run([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\\"ci"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ty\\":\\"Aalborg\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":8}}\n\n',
    "data: [DONE]\n\n",
  ]);
  const toolCall = events.find((e) => e.type === "tool_call") as { id: string; name: string; args: Record<string, unknown> };
  expect(toolCall).toBeDefined();
  expect(toolCall.id).toBe("call_1");
  expect(toolCall.name).toBe("get_weather");
  expect(toolCall.args).toEqual({ city: "Aalborg" });
  const finish = events.find((e) => e.type === "finish") as { reason: string };
  expect(finish.reason).toBe("tool_calls");
  // usage event precedes the terminal finish
  expect(events.some((e) => e.type === "usage")).toBe(true);
  expect(events[events.length - 1]!.type).toBe("finish");
});
