import { expect, test } from "bun:test";
import { createAI } from "../client.js";
import { freshUsage } from "../cost/usage.js";
import type { ChatRequest, ChatResult, ProviderAdapter } from "../types.js";

/** A fake provider that records the messages it was handed. */
function capturingAdapter(): { adapter: ProviderAdapter; seen: () => ChatRequest | undefined } {
  let captured: ChatRequest | undefined;
  const adapter: ProviderAdapter = {
    name: "anthropic",
    async chat(req: ChatRequest): Promise<ChatResult> {
      captured = req;
      return {
        text: "ok",
        usage: freshUsage({
          provider: "anthropic",
          model: req.spec.model,
          transport: "http",
          capability: "chat",
          inputTokens: 1,
          outputTokens: 1,
        }),
      };
    },
  };
  return { adapter, seen: () => captured };
}

const route = {
  tier: "smart" as const,
  override: { provider: "anthropic", model: "claude-haiku-4-5-20251001", transport: "http" as const },
};

test("ai.chat keeps a top-level `system` when `messages` is also supplied (cms #4234)", async () => {
  const { adapter, seen } = capturingAdapter();
  const ai = createAI({ providers: { anthropic: adapter } });
  await ai.chat({
    ...route,
    system: "Return ONLY a JSON object.",
    messages: [{ role: "user", content: "Proofread this." }],
  });
  const msgs = seen()!.messages;
  expect(msgs[0]).toEqual({ role: "system", content: "Return ONLY a JSON object." });
  expect(msgs[1]).toEqual({ role: "user", content: "Proofread this." });
});

test("ai.chat does not duplicate a system message the caller already leads with", async () => {
  const { adapter, seen } = capturingAdapter();
  const ai = createAI({ providers: { anthropic: adapter } });
  await ai.chat({
    ...route,
    system: "should-not-be-added",
    messages: [
      { role: "system", content: "caller-system" },
      { role: "user", content: "hi" },
    ],
  });
  const msgs = seen()!.messages;
  expect(msgs.filter((m) => m.role === "system").length).toBe(1);
  expect(msgs[0]).toEqual({ role: "system", content: "caller-system" });
});

test("ai.chat still builds system from the prompt path (no messages)", async () => {
  const { adapter, seen } = capturingAdapter();
  const ai = createAI({ providers: { anthropic: adapter } });
  await ai.chat({ ...route, system: "SYS", prompt: "hello" });
  const msgs = seen()!.messages;
  expect(msgs[0]).toEqual({ role: "system", content: "SYS" });
  expect(msgs[1]).toEqual({ role: "user", content: "hello" });
});
