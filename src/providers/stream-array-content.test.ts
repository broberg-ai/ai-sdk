// F098.1 — reported by cardmem 2026-11-26: chatStream against mistral-large-4-0 lost its
// first words. The SSE below is the shape MEASURED from api.mistral.ai the same day:
// thinking parts as a list, then a list with the first text part, then plain strings.
import { expect, test } from "bun:test";
import { mistralAdapter } from "./mistral.js";

const SSE = [
  { delta: { role: "assistant", content: "" } },
  { delta: { content: [{ type: "thinking", thinking: [{ type: "text", text: "The user wants me" }], closed: true }] } },
  { delta: { content: [{ type: "thinking", thinking: [{ type: "text", text: " to reply with exactly" }], closed: true }] } },
  { delta: { content: [{ type: "text", text: "Fly hosts" }] } },
  { delta: { content: " the app in arn" } },
  { delta: { content: "." }, finish_reason: "stop" },
]
  .map((c) => `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", model: "mistral-large-4-0", choices: [{ index: 0, ...c }] })}\n\n`)
  .join("") + `data: ${JSON.stringify({ id: "x", choices: [], usage: { prompt_tokens: 20, completion_tokens: 9 } })}\n\ndata: [DONE]\n\n`;

test("F098 a list-shaped delta.content yields its text parts; thinking never reaches the stream", async () => {
  const f = (async () => new Response(SSE, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
  const a = mistralAdapter({ apiKey: "k", fetch: f });
  let text = "";
  for await (const ev of a.chatStream!({ messages: [{ role: "user", content: "x" }], spec: { provider: "mistral", model: "mistral-large-4-0", transport: "http" } } as never)) {
    if (ev.type === "text") text += ev.delta;
  }
  expect(text).toBe("Fly hosts the app in arn.");
});
