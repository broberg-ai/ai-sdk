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

// ── F059 — an unreadable reply must not destroy a 444-example measurement ────────
//
// Requested by trail with the measurement behind it. The throw is RIGHT in product
// use and stays the default; it is destructive in a batch, where it stops the loop
// and leaves everything after it looking like it never existed.

test("F059: outcome is set on all three paths, and answered ⟺ label !== null", async () => {
  const labels = ["approved", "denied"];

  const hit = makeContracts(fakeClient({ chat: ['{"label":"approved","confidence":0.9}'] }).client);
  const a = await hit.classify({ text: "x", labels });
  expect(a.outcome).toBe("answered");
  expect(a.label).toBe("approved");

  const off = makeContracts(fakeClient({ chat: ['{"label":"maybe","confidence":0.4}'] }).client);
  const b = await off.classify({ text: "x", labels });
  expect(b.outcome).toBe("out-of-set");
  expect(b.label).toBeNull();
  expect(b.rawLabel).toBe("maybe");

  const bad = makeContracts(fakeClient({ chat: ["I'm sorry, I can't help with that."] }).client);
  const c = await bad.classify({ text: "x", labels, onUnparseable: "value" });
  expect(c.outcome).toBe("unparseable");
  expect(c.label).toBeNull();
  expect(c.confidence).toBeNull();
});

test("F059: the DEFAULT still throws on an unreadable reply — unchanged", async () => {
  const c = makeContracts(fakeClient({ chat: ["I'm sorry, I can't help with that."] }).client);
  // No onUnparseable, and the explicit "throw", must behave identically to 0.48.0.
  await expect(c.classify({ text: "x", labels: ["a", "b"] })).rejects.toThrow(
    "no JSON found in model output",
  );
  const c2 = makeContracts(fakeClient({ chat: ["nope"] }).client);
  await expect(
    c2.classify({ text: "x", labels: ["a", "b"], onUnparseable: "throw" }),
  ).rejects.toThrow("no JSON found in model output");
});

// THE TEST THAT PROVES THE CARD, not merely that the field exists. trail's own shape:
// a batch where one example is unreadable. With the flag the loop completes; without
// it the loop dies partway and the rest are indistinguishable from never having run.
test("F059: a batch with one unreadable reply completes with 'value' and aborts by default", async () => {
  const replies = [
    '{"label":"approved","confidence":0.9}',
    '{"label":"maybe"}', // parseable, out of set
    "I cannot answer that.", // unreadable — this is the one that used to kill the run
    '{"label":"denied","confidence":0.7}',
  ];
  const labels = ["approved", "denied"];

  const counted = { answered: 0, "out-of-set": 0, unparseable: 0 } as Record<string, number>;
  const withFlag = makeContracts(fakeClient({ chat: replies }).client);
  for (const _ of replies) {
    const r = await withFlag.classify({ text: "x", labels, onUnparseable: "value" });
    counted[r.outcome] = (counted[r.outcome] ?? 0) + 1;
  }
  // All four measured, and the three categories are countable SEPARATELY — which is
  // the thing trail could not do before: "got it wrong", "did not answer" and "could
  // not be read" were not three numbers.
  expect(counted).toEqual({ answered: 2, "out-of-set": 1, unparseable: 1 });

  // And the default still aborts, so nobody gets the new behaviour by accident.
  const noFlag = makeContracts(fakeClient({ chat: replies }).client);
  let completed = 0;
  await expect(
    (async () => {
      for (const _ of replies) {
        await noFlag.classify({ text: "x", labels });
        completed += 1;
      }
    })(),
  ).rejects.toThrow();
  expect(completed).toBe(2); // died on the third — the 4th was never measured
});

test("F059: out-of-set and unparseable are told apart WITHOUT reading rawLabel's content", async () => {
  const labels = ["approved", "denied"];
  const off = await makeContracts(
    fakeClient({ chat: ['{"label":"maybe"}'] }).client,
  ).classify({ text: "x", labels, onUnparseable: "value" });
  const bad = await makeContracts(
    fakeClient({ chat: ["maybe"] }).client, // same WORD, but not JSON
  ).classify({ text: "x", labels, onUnparseable: "value" });

  // Deliberately adversarial: both carry rawLabel "maybe", both have label null. If the
  // discriminator were inferred from the fields instead of stated, these two would be
  // the same value — which is the bug this card exists to prevent.
  expect(off.rawLabel).toBe(bad.rawLabel);
  expect(off.label).toBe(bad.label);
  expect(off.outcome).not.toBe(bad.outcome);
  expect(off.outcome).toBe("out-of-set");
  expect(bad.outcome).toBe("unparseable");
});

test("F059: 'unparseable' covers MALFORMED json too, not only a reply with none", async () => {
  // Raised in review of this card: the catch takes both ways parseJsonLoose fails, while
  // the type doc said only "no JSON". trail is going to COUNT this category, so the
  // wider meaning is now documented — and a documented claim gets a test, not a promise.
  const labels = ["approved", "denied"];

  const noJson = await makeContracts(
    fakeClient({ chat: ["I cannot answer that."] }).client,
  ).classify({ text: "x", labels, onUnparseable: "value" });

  const truncated = await makeContracts(
    fakeClient({ chat: ['{"label":"appro'] }).client, // a bracket IS present; JSON.parse dies
  ).classify({ text: "x", labels, onUnparseable: "value" });

  expect(noJson.outcome).toBe("unparseable");
  expect(truncated.outcome).toBe("unparseable");

  // And both still THROW under the default, from the two different error paths.
  await expect(
    makeContracts(fakeClient({ chat: ['{"label":"appro'] }).client).classify({ text: "x", labels }),
  ).rejects.toThrow();
});
