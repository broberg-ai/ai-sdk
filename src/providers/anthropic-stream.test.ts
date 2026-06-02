import { expect, test } from "bun:test";
import { anthropicAdapter } from "./anthropic.js";
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

const spec = { provider: "anthropic", model: "claude-sonnet-4-6", transport: "http" as const };

async function run(lines: string[]): Promise<ChatStreamEvent[]> {
  const adapter = anthropicAdapter({ apiKey: "k", fetch: sseFetch(lines) });
  const out: ChatStreamEvent[] = [];
  for await (const ev of adapter.chatStream!({ messages: [{ role: "user", content: "hi" }], spec })) {
    out.push(ev);
  }
  return out;
}

test("streams text deltas, usage, then finish", async () => {
  const events = await run([
    'data: {"type":"message_start","message":{"usage":{"input_tokens":12}}}\n\n',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
    'data: {"type":"message_stop"}\n\n',
  ]);
  const text = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
  expect(text).toBe("Hello");
  const usage = events.find((e) => e.type === "usage") as { usage: { inputTokens: number; outputTokens: number } };
  expect(usage.usage.inputTokens).toBe(12);
  expect(usage.usage.outputTokens).toBe(2);
  expect(events[events.length - 1]).toEqual({ type: "finish", reason: "end_turn" });
});

test("accumulates a tool_use block and emits a complete tool_call", async () => {
  const events = await run([
    'data: {"type":"message_start","message":{"usage":{"input_tokens":20}}}\n\n',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather"}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"ci"}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"ty\\":\\"Aalborg\\"}"}}\n\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":15}}\n\n',
    'data: {"type":"message_stop"}\n\n',
  ]);
  const tc = events.find((e) => e.type === "tool_call") as { id: string; name: string; args: Record<string, unknown> };
  expect(tc.id).toBe("toolu_1");
  expect(tc.name).toBe("get_weather");
  expect(tc.args).toEqual({ city: "Aalborg" });
  const finish = events.find((e) => e.type === "finish") as { reason: string };
  expect(finish.reason).toBe("tool_calls");
});

test("streaming over subprocess transport throws a clear error", async () => {
  const adapter = anthropicAdapter({ apiKey: "k" });
  const it = adapter.chatStream!({ messages: [{ role: "user", content: "hi" }], spec: { ...spec, transport: "subprocess" } });
  await expect((async () => { for await (const _ of it) void _; })()).rejects.toThrow(/not supported over the subprocess/);
});
