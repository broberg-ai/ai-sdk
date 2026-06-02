import { expect, test } from "bun:test";
import { z } from "zod";
import { makeContracts, parseJsonLoose } from "./index.js";
import type { ChatResult, Usage } from "../../types.js";

const usage = (): Usage => ({
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  transport: "http",
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0.001,
  latencyMs: 100,
  capability: "chat",
  ts: "2026-06-02T00:00:00.000Z",
});

/** Build a fake ChatVision client whose chat/vision return scripted replies. */
function fakeClient(replies: { chat?: string[]; vision?: string }) {
  let chatIdx = 0;
  const chatCalls: any[] = [];
  const visionCalls: any[] = [];
  return {
    chatCalls,
    visionCalls,
    client: {
      chat: async (input: any): Promise<ChatResult> => {
        chatCalls.push(input);
        const text = replies.chat?.[Math.min(chatIdx++, (replies.chat?.length ?? 1) - 1)] ?? "";
        return { text, usage: usage() };
      },
      vision: async (input: any): Promise<ChatResult> => {
        visionCalls.push(input);
        return { text: replies.vision ?? "", usage: usage() };
      },
    },
  };
}

test("parseJsonLoose strips fences + surrounding prose", () => {
  expect(parseJsonLoose('here:\n```json\n{"a":1}\n```\ndone')).toEqual({ a: 1 });
  expect(parseJsonLoose('[{"x":2}]')).toEqual([{ x: 2 }]);
});

test("mockup returns html from chat", async () => {
  const { client, chatCalls } = fakeClient({ chat: ["<html>mock</html>"] });
  const res = await makeContracts(client).mockup({ description: "a landing page" });
  expect(res.html).toBe("<html>mock</html>");
  expect(res.usage.costUsd).toBe(0.001);
  expect(chatCalls[0].purpose).toBe("contract:mockup");
});

test("design uses vision (image + instructions)", async () => {
  const { client, visionCalls } = fakeClient({ vision: "<html>redesign</html>" });
  const res = await makeContracts(client).design({
    screenshot: "https://x/shot.png",
    instructions: "make it dark",
  });
  expect(res.html).toBe("<html>redesign</html>");
  expect(visionCalls[0].image).toBe("https://x/shot.png");
});

test("extract validates against the Zod schema", async () => {
  const { client } = fakeClient({ chat: ['{"name":"Sanne","age":40}'] });
  const schema = z.object({ name: z.string(), age: z.number() });
  const res = await makeContracts(client).extract({ text: "Sanne is 40", schema });
  expect(res.data).toEqual({ name: "Sanne", age: 40 });
});

test("extract retries once on invalid JSON, then succeeds", async () => {
  const { client, chatCalls } = fakeClient({ chat: ["not json at all", '{"ok":true}'] });
  const schema = z.object({ ok: z.boolean() });
  const res = await makeContracts(client).extract({ text: "x", schema });
  expect(res.data).toEqual({ ok: true });
  expect(chatCalls).toHaveLength(2); // initial + one retry
});

test("extract throws if both attempts fail", async () => {
  const { client } = fakeClient({ chat: ["garbage", "still garbage"] });
  const schema = z.object({ ok: z.boolean() });
  await expect(makeContracts(client).extract({ text: "x", schema })).rejects.toThrow();
});

test("classify constrains the label to the provided set", async () => {
  const { client } = fakeClient({ chat: ['{"label":"spam","confidence":0.9}'] });
  const res = await makeContracts(client).classify({ text: "buy now", labels: ["spam", "ham"] });
  expect(res.label).toBe("spam");
  expect(res.confidence).toBe(0.9);
});

test("classify falls back to first label when model returns an unknown label", async () => {
  const { client } = fakeClient({ chat: ['{"label":"???","confidence":0.5}'] });
  const res = await makeContracts(client).classify({ text: "x", labels: ["a", "b"] });
  expect(res.label).toBe("a");
});

test("rerank sorts items by score desc", async () => {
  const { client } = fakeClient({
    chat: ['[{"item":"low","score":0.2},{"item":"high","score":0.9}]'],
  });
  const res = await makeContracts(client).rerank({ query: "q", items: ["low", "high"] });
  expect(res.ranked.map((r) => r.item)).toEqual(["high", "low"]);
});

test("ai.contracts is wired on the real client", async () => {
  const { createAI } = await import("../../client.js");
  const { stubProviders } = await import("../../providers/stub.js");
  const ai = createAI({ providers: stubProviders });
  expect(typeof ai.contracts.mockup).toBe("function");
  expect(typeof ai.contracts.extract).toBe("function");
});
