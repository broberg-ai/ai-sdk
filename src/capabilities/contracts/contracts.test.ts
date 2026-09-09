import { expect, test } from "bun:test";
import { z } from "zod";
import { makeContracts, parseJsonLoose } from "./index.js";
import type { ChatResult, Usage } from "../../types.js";

const usage = (): Usage => ({
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  region: "eu" as const,
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

// ── F052: a silent fallback had a PASSING TEST defending it ────────────────
// The test this replaces asserted `res.label === "a"` — the first label — as the
// intended behaviour on an unknown answer. So the suite being green proved the
// fallback was DELIBERATE, not that it was right. Worth stating plainly: a green
// suite is evidence about intent, never about correctness.

test("classify returns null for an unknown label — NOT the first one", async () => {
  const { client } = fakeClient({ chat: ['{"label":"???","confidence":0.5}'] });
  const res = await makeContracts(client).classify({ text: "x", labels: ["a", "b"] });
  expect(res.label).toBeNull();
  // The model's own answer is preserved, so the failure is inspectable rather than
  // merely reported. helpdesk routes an autonomy level off this field.
  expect(res.rawLabel).toBe("???");
});

test("classify THROWS when the reply contains no JSON — measured, not assumed", async () => {
  // The report said the fallback fired on "unreadable OR unknown". Measured: a reply
  // with no JSON in it already threw in parseJsonLoose and still does. So the hole was
  // narrower than described — and it was the more dangerous half, because a parseable
  // answer naming an unknown label LOOKS like a real classification. Pinned so the
  // difference between the two cases stays deliberate.
  const { client } = fakeClient({ chat: ["I'm sorry, I can't do that"] });
  await expect(makeContracts(client).classify({ text: "x", labels: ["a", "b"] })).rejects.toThrow(/no JSON found/);
});

test("classify: confidence 0 from the MODEL survives as 0, not null", async () => {
  // The negative control for the nullable change, and the load-bearing half: a test
  // that only checked the null case would pass on an implementation that always
  // answered null. Two states, two values — that is the whole point of the field.
  const { client } = fakeClient({ chat: ['{"label":"a","confidence":0}'] });
  const res = await makeContracts(client).classify({ text: "x", labels: ["a", "b"] });
  expect(res.label).toBe("a");
  expect(res.confidence).toBe(0);
  expect(res.confidence).not.toBeNull();
});

test("classify: a MISSING confidence is null, not 0", async () => {
  const { client } = fakeClient({ chat: ['{"label":"a"}'] });
  const res = await makeContracts(client).classify({ text: "x", labels: ["a", "b"] });
  expect(res.confidence).toBeNull();
});

test("classify: a clean answer carries NO rawLabel — the field is not decoration", async () => {
  const { client } = fakeClient({ chat: ['{"label":"spam","confidence":0.9}'] });
  const res = await makeContracts(client).classify({ text: "x", labels: ["spam", "ham"] });
  expect(res.rawLabel).toBeUndefined();
});

test("rerank sorts items by score desc", async () => {
  const { client } = fakeClient({
    chat: ['[{"item":"low","score":0.2},{"item":"high","score":0.9}]'],
  });
  const res = await makeContracts(client).rerank({ query: "q", items: ["low", "high"] });
  expect(res.ranked.map((r) => r.item)).toEqual(["high", "low"]);
  // NEGATIVE CONTROL: a clean answer leaves nothing unscored. Without this, `unscored`
  // could be unconditional noise, and noise gets ignored.
  expect(res.unscored).toEqual([]);
});

test("rerank THROWS on a reply with no JSON — it does not return an empty ranking", async () => {
  // "The model ranked nothing" and "I could not read the reply" were the same []. Note
  // WHICH throw fires: this one comes from parseJsonLoose, which was already there. The
  // hole was the case below — valid JSON that simply is not an array.
  const { client } = fakeClient({ chat: ["not json at all"] });
  await expect(makeContracts(client).rerank({ query: "q", items: ["a"] })).rejects.toThrow(/no JSON found/);
});

test("rerank THROWS when the reply is a JSON OBJECT rather than an array", async () => {
  const { client } = fakeClient({ chat: ['{"item":"a","score":1}'] });
  await expect(makeContracts(client).rerank({ query: "q", items: ["a"] })).rejects.toThrow(/did not return a JSON array/);
});

test("rerank NAMES what the model failed to score", async () => {
  const { client } = fakeClient({ chat: ['[{"item":"a","score":0.9}]'] });
  const res = await makeContracts(client).rerank({ query: "q", items: ["a", "b", "c"] });
  expect(res.ranked).toEqual([{ item: "a", score: 0.9 }]);
  expect(res.unscored).toEqual(["b", "c"]);
});

test("rerank drops an item the model INVENTED, and an entry with no score", async () => {
  const { client } = fakeClient({
    chat: '[{"item":"a","score":0.9},{"item":"never-sent","score":1},{"item":"b"},{"score":0.5}]'.split("\u0000"),
  });
  const res = await makeContracts(client).rerank({ query: "q", items: ["a", "b"] });
  // "never-sent" is not a ranking of anything we asked about; the entry with no `item`
  // used to become "" with score 0 — a plausible-looking row ranked last.
  expect(res.ranked).toEqual([{ item: "a", score: 0.9 }]);
  expect(res.unscored).toEqual(["b"]);
});

test("rerank: score 0 from the model is a REAL score, kept and ranked", async () => {
  const { client } = fakeClient({ chat: ['[{"item":"a","score":0},{"item":"b","score":0.5}]'] });
  const res = await makeContracts(client).rerank({ query: "q", items: ["a", "b"] });
  expect(res.ranked).toEqual([{ item: "b", score: 0.5 }, { item: "a", score: 0 }]);
  expect(res.unscored).toEqual([]);
});

test("extract STILL throws — the contract that was already right is untouched", async () => {
  // One of three contracts had the answer all along. Pinned so a later "harmonisation"
  // cannot quietly make it match the two that were wrong.
  const { client } = fakeClient({ chat: ["garbage", "still garbage"] });
  await expect(
    makeContracts(client).extract({ text: "x", schema: z.object({ ok: z.boolean() }) }),
  ).rejects.toThrow();
});

test("ai.contracts is wired on the real client", async () => {
  const { createAI } = await import("../../client.js");
  const { stubProviders } = await import("../../providers/stub.js");
  const ai = createAI({ providers: stubProviders });
  expect(typeof ai.contracts.mockup).toBe("function");
  expect(typeof ai.contracts.extract).toBe("function");
});
