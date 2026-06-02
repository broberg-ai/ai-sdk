import { expect, test } from "bun:test";
import { createAI } from "../client.js";
import { upmetricsSink } from "./sinks/upmetrics.js";
import { freshUsage } from "./usage.js";
import type { CostSink, Usage, ProviderAdapter, ChatResult } from "../types.js";

function fakeChatAdapter(name: string): ProviderAdapter {
  return {
    name,
    async chat(): Promise<ChatResult> {
      return { text: "ok", usage: freshUsage({ provider: name, model: "m", transport: "http", capability: "chat", inputTokens: 1, outputTokens: 1 }) };
    },
  };
}

test("labels flow from CallOptions onto the reported Usage", async () => {
  const recorded: Usage[] = [];
  const sink: CostSink = { record: (u) => void recorded.push(u) };
  const ai = createAI({ costSink: sink, providers: { fake: fakeChatAdapter("fake") } });
  await ai.chat({ prompt: "hi", override: { provider: "fake", model: "m", transport: "http" }, labels: { tenantId: "sanne", kbId: "kb_42" } });
  expect(recorded).toHaveLength(1);
  expect(recorded[0]!.labels).toEqual({ tenantId: "sanne", kbId: "kb_42" });
});

test("no labels key on Usage when none supplied", async () => {
  const recorded: Usage[] = [];
  const ai = createAI({ costSink: { record: (u) => void recorded.push(u) }, providers: { fake: fakeChatAdapter("fake") } });
  await ai.chat({ prompt: "hi", override: { provider: "fake", model: "m", transport: "http" } });
  expect(recorded[0]!.labels).toBeUndefined();
});

test("upmetricsSink merges labels into tags; reserved keys win", async () => {
  let body: { tags?: Record<string, string> } = {};
  const fetchImpl = (async (_url: string, init: { body?: string }) => {
    body = JSON.parse(init.body ?? "{}");
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const sink = upmetricsSink({ baseUrl: "https://up.test", apiKey: "k", agentName: "trail", fetch: fetchImpl });

  const usage = freshUsage({ provider: "anthropic", model: "m", transport: "http", capability: "chat", inputTokens: 1, outputTokens: 1 });
  // a malicious label tries to clobber a reserved key
  usage.labels = { tenantId: "sanne", capability: "HACK" };
  await sink.record(usage);

  expect(body.tags!.tenantId).toBe("sanne");
  expect(body.tags!.capability).toBe("chat"); // reserved key not clobbered by the label
  expect(body.tags!.transport).toBe("http");
  expect(typeof body.tags!.sdk).toBe("string");
});
