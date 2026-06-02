import { expect, test } from "bun:test";
import { makeOpenAICompatibleAdapter, toOpenAIMessage } from "./openai-compatible.js";
import type { Message } from "../types.js";

test("assistant message with toolCalls serializes to wire tool_calls[]", () => {
  const m: Message = {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call_1", name: "get_weather", arguments: { city: "Aalborg" } }],
  };
  const wire = toOpenAIMessage(m);
  expect(wire).toEqual({
    role: "assistant",
    content: "",
    tool_calls: [
      { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Aalborg"}' } },
    ],
  });
});

test("tool-role message serializes to {role:'tool', tool_call_id, content}", () => {
  const m: Message = { role: "tool", content: '{"temp":12}', toolCallId: "call_1" };
  expect(toOpenAIMessage(m)).toEqual({ role: "tool", content: '{"temp":12}', tool_call_id: "call_1" });
});

test("a 2-turn tool conversation round-trips through the serializer", () => {
  const conversation: Message[] = [
    { role: "user", content: "weather in Aalborg?" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "get_weather", arguments: { city: "Aalborg" } }] },
    { role: "tool", content: '{"temp":12}', toolCallId: "c1" },
    { role: "assistant", content: "It is 12°C in Aalborg." },
  ];
  const wire = conversation.map(toOpenAIMessage);
  // assistant tool-call turn keeps its tool_calls; tool turn keeps tool_call_id;
  // the ids line up so the model can thread the loop.
  expect((wire[1] as { tool_calls: { id: string }[] }).tool_calls[0]!.id).toBe("c1");
  expect((wire[2] as { tool_call_id: string }).tool_call_id).toBe("c1");
  expect((wire[3] as { tool_calls?: unknown }).tool_calls).toBeUndefined();
});

test("ai.chatStream threads tool messages to the wire body", async () => {
  let sentBody: { messages?: Record<string, unknown>[] } | undefined;
  const captureFetch = (async (_url: string, init: { body?: string }) => {
    sentBody = JSON.parse(init.body ?? "{}");
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
        c.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;

  const adapter = makeOpenAICompatibleAdapter({
    name: "openrouter",
    baseUrl: "https://openrouter.test/api/v1",
    apiKey: "k",
    fetch: captureFetch,
  });
  const messages: Message[] = [
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "f", arguments: { a: 1 } }] },
    { role: "tool", content: "ok", toolCallId: "c1" },
  ];
  for await (const _ of adapter.chatStream!({ messages, spec: { provider: "openrouter", model: "m", transport: "http" } })) {
    void _;
  }
  expect(sentBody?.messages?.[0]).toMatchObject({ tool_calls: [{ id: "c1" }] });
  expect(sentBody?.messages?.[1]).toMatchObject({ tool_call_id: "c1" });
});
