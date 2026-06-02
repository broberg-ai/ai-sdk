import { expect, test } from "bun:test";
import { anthropicAdapter } from "./anthropic.js";
import type { ChatRequest, Message } from "../types.js";

const spec = { provider: "anthropic", model: "claude-sonnet-4-6", transport: "http" as const };

// A tool-loop conversation: user → assistant(tool_use) → tool(result) → continue.
const conversation: Message[] = [
  { role: "user", content: "weather in Aalborg?" },
  { role: "assistant", content: "", toolCalls: [{ id: "toolu_1", name: "get_weather", arguments: { city: "Aalborg" } }] },
  { role: "tool", content: '{"temp":12}', toolCallId: "toolu_1" },
];

interface AnthropicBody {
  messages: { role: string; content: unknown }[];
}

function assertThreaded(body: AnthropicBody) {
  // assistant turn carries a tool_use block
  const assistant = body.messages[1]!;
  expect(assistant.role).toBe("assistant");
  expect(assistant.content).toEqual([{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Aalborg" } }]);
  // tool turn became a user message with a tool_result block
  const toolTurn = body.messages[2]!;
  expect(toolTurn.role).toBe("user");
  expect(toolTurn.content).toEqual([{ type: "tool_result", tool_use_id: "toolu_1", content: '{"temp":12}' }]);
}

test("chatHttp threads assistant tool_use + tool_result blocks", async () => {
  const realFetch = globalThis.fetch;
  let sent: AnthropicBody = { messages: [] };
  globalThis.fetch = (async (_url: string, init: { body?: string }) => {
    sent = JSON.parse(init.body ?? "{}");
    return new Response(JSON.stringify({ content: [{ type: "text", text: "12°C" }], usage: { input_tokens: 5, output_tokens: 3 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  try {
    const adapter = anthropicAdapter({ apiKey: "k" });
    await adapter.chat!({ messages: conversation, spec } as ChatRequest);
    assertThreaded(sent);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("chatStream threads the same blocks (shared buildBody)", async () => {
  let sent: AnthropicBody = { messages: [] };
  const captureFetch = (async (_url: string, init: { body?: string }) => {
    sent = JSON.parse(init.body ?? "{}");
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"type":"message_stop"}\n\n'));
        c.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  const adapter = anthropicAdapter({ apiKey: "k", fetch: captureFetch });
  for await (const _ of adapter.chatStream!({ messages: conversation, spec } as ChatRequest)) void _;
  assertThreaded(sent);
});
