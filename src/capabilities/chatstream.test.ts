import { expect, test } from "bun:test";
import { createAI } from "../client.js";
import { freshUsage } from "../cost/usage.js";
import type { ChatStreamEvent, ProviderAdapter, Usage, CostSink } from "../types.js";

const spec = (provider: string) => ({ provider, model: "m", transport: "http" as const });

/** Adapter that replays a fixed event list. */
function fakeStreamAdapter(name: string, events: ChatStreamEvent[]): ProviderAdapter {
  return {
    name,
    // eslint-disable-next-line require-yield
    async *chatStream() {
      for (const ev of events) yield ev;
    },
  };
}

/** Adapter whose stream throws before/after emitting. */
function throwingAdapter(name: string, opts: { status?: number; afterText?: boolean }): ProviderAdapter {
  return {
    name,
    async *chatStream() {
      if (opts.afterText) yield { type: "text", delta: "partial" };
      const err = new Error("boom") as Error & { status?: number };
      if (opts.status !== undefined) err.status = opts.status;
      throw err;
    },
  };
}

const usage = (): Usage => freshUsage({ provider: "fake", model: "m", transport: "http", capability: "chat", inputTokens: 10, outputTokens: 5 });

async function collect(it: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

test("text deltas + finish pass through in order", async () => {
  const ai = createAI({
    providers: {
      fake: fakeStreamAdapter("fake", [
        { type: "text", delta: "Hel" },
        { type: "text", delta: "lo" },
        { type: "finish", reason: "stop" },
      ]),
    },
  });
  const events = await collect(ai.chatStream({ prompt: "hi", override: spec("fake") }));
  expect(events.map((e) => e.type)).toEqual(["text", "text", "finish"]);
  const text = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
  expect(text).toBe("Hello");
});

test("usage event is reported to the cost sink", async () => {
  const recorded: Usage[] = [];
  const sink: CostSink = { record: (u) => void recorded.push(u) };
  const ai = createAI({
    costSink: sink,
    providers: {
      fake: fakeStreamAdapter("fake", [
        { type: "text", delta: "x" },
        { type: "usage", costUsd: 0.001, model: "m", usage: usage() },
        { type: "finish", reason: "end_turn" },
      ]),
    },
  });
  const events = await collect(ai.chatStream({ prompt: "hi", override: spec("fake"), purpose: "test" }));
  expect(events.some((e) => e.type === "usage")).toBe(true);
  expect(recorded).toHaveLength(1);
  // client stamps call-context onto the reported Usage
  expect(recorded[0]!.capability).toBe("chat");
  expect(recorded[0]!.purpose).toBe("test");
});

test("pre-first-token eligible error falls back to the next route", async () => {
  const ai = createAI({
    providers: {
      boom: throwingAdapter("boom", { status: 503 }),
      fake: fakeStreamAdapter("fake", [
        { type: "text", delta: "recovered" },
        { type: "finish", reason: "stop" },
      ]),
    },
  });
  const events = await collect(
    ai.chatStream({ prompt: "hi", override: spec("boom"), fallback: [spec("fake")] }),
  );
  expect(events.map((e) => e.type)).toEqual(["text", "finish"]);
});

test("hard 4xx does NOT fall back — surfaces an error event", async () => {
  const ai = createAI({
    providers: {
      boom: throwingAdapter("boom", { status: 400 }),
      fake: fakeStreamAdapter("fake", [{ type: "text", delta: "should-not-reach" }]),
    },
  });
  const events = await collect(
    ai.chatStream({ prompt: "hi", override: spec("boom"), fallback: [spec("fake")] }),
  );
  expect(events).toHaveLength(1);
  expect(events[0]!.type).toBe("error");
  expect((events[0] as { status?: number }).status).toBe(400);
});

test("error after the first token surfaces an error event (no re-route)", async () => {
  const ai = createAI({
    providers: {
      boom: throwingAdapter("boom", { status: 503, afterText: true }),
      fake: fakeStreamAdapter("fake", [{ type: "text", delta: "unused" }]),
    },
  });
  const events = await collect(
    ai.chatStream({ prompt: "hi", override: spec("boom"), fallback: [spec("fake")] }),
  );
  expect(events.map((e) => e.type)).toEqual(["text", "error"]);
});

test("missing chatStream support throws a clear error", async () => {
  const ai = createAI({ providers: { plain: { name: "plain", async chat() { throw new Error("x"); } } } });
  await expect(collect(ai.chatStream({ prompt: "hi", override: spec("plain") }))).rejects.toThrow(
    /does not support streaming/,
  );
});
