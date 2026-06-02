import { expect, test } from "bun:test";
import { geminiAdapter } from "./gemini.js";
import type { ChatStreamEvent } from "../types.js";

function sseFetch(lines: string[]): typeof fetch {
  return (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (const l of lines) c.enqueue(enc.encode(l));
        c.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

const spec = { provider: "gemini", model: "gemini-2.5-flash", transport: "http" as const };

async function run(lines: string[]): Promise<ChatStreamEvent[]> {
  const adapter = geminiAdapter({ apiKey: "k", fetch: sseFetch(lines) });
  const out: ChatStreamEvent[] = [];
  for await (const ev of adapter.chatStream!({ messages: [{ role: "user", content: "hi" }], spec })) {
    out.push(ev);
  }
  return out;
}

test("streams text parts, usage, then finish", async () => {
  const events = await run([
    'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":2}}\n\n',
  ]);
  const text = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
  expect(text).toBe("Hello");
  const usage = events.find((e) => e.type === "usage") as { usage: { inputTokens: number; outputTokens: number } };
  expect(usage.usage.inputTokens).toBe(8);
  expect(usage.usage.outputTokens).toBe(2);
  expect(events[events.length - 1]).toEqual({ type: "finish", reason: "end_turn" });
});

test("emits a functionCall part as a complete tool_call → finish tool_calls", async () => {
  const events = await run([
    'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weather","args":{"city":"Aalborg"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":15,"candidatesTokenCount":7}}\n\n',
  ]);
  const tc = events.find((e) => e.type === "tool_call") as { name: string; args: Record<string, unknown> };
  expect(tc.name).toBe("get_weather");
  expect(tc.args).toEqual({ city: "Aalborg" });
  const finish = events.find((e) => e.type === "finish") as { reason: string };
  expect(finish.reason).toBe("tool_calls");
});
