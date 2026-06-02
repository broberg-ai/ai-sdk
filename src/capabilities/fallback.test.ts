import { expect, test } from "bun:test";
import { createAI } from "../client.js";
import { freshUsage } from "../cost/usage.js";
import { BudgetExceededError } from "../cost/budget.js";
import type { ProviderAdapter, ChatResult } from "../types.js";

const okUsage = (provider: string, model: string) =>
  freshUsage({ provider, model, transport: "http", capability: "chat", inputTokens: 1, outputTokens: 1 });

function failing(name: string): ProviderAdapter {
  return { name, chat: async () => { throw new Error(`${name} down`); } };
}
function working(name: string, text: string): ProviderAdapter {
  return {
    name,
    chat: async (req): Promise<ChatResult> => ({ text, usage: okUsage(name, req.spec.model) }),
  };
}

test("fallback: primary errors → fallback route succeeds", async () => {
  const ai = createAI({
    providers: { p1: failing("p1"), p2: working("p2", "from-fallback") },
  });
  const res = await ai.chat({
    prompt: "hi",
    override: { provider: "p1", model: "m", transport: "http" },
    fallback: [{ provider: "p2", model: "m", transport: "http" }],
  });
  expect(res.text).toBe("from-fallback");
  expect(res.usage.provider).toBe("p2");
});

test("fallback: first working route wins, later ones not tried", async () => {
  const ai = createAI({
    providers: { p1: failing("p1"), p2: working("p2", "second"), p3: working("p3", "third") },
  });
  const res = await ai.chat({
    prompt: "hi",
    override: { provider: "p1", model: "m", transport: "http" },
    fallback: [
      { provider: "p2", model: "m", transport: "http" },
      { provider: "p3", model: "m", transport: "http" },
    ],
  });
  expect(res.text).toBe("second");
});

test("fallback: all routes fail → throws the last error", async () => {
  const ai = createAI({ providers: { p1: failing("p1"), p2: failing("p2") } });
  await expect(
    ai.chat({
      prompt: "hi",
      override: { provider: "p1", model: "m", transport: "http" },
      fallback: [{ provider: "p2", model: "m", transport: "http" }],
    }),
  ).rejects.toThrow(/p2 down/);
});

test("fallback: capability-missing primary → explicit working spec", async () => {
  const noChat: ProviderAdapter = { name: "novocab" };
  const ai = createAI({ providers: { novocab: noChat, p2: working("p2", "rescued") } });
  const res = await ai.chat({
    prompt: "hi",
    override: { provider: "novocab", model: "m", transport: "http" },
    fallback: [{ provider: "p2", model: "m", transport: "http" }],
  });
  expect(res.text).toBe("rescued");
});

test("budget breach propagates — it is NOT a fallback trigger", async () => {
  // sonnet is priced, tiny ceiling → preflight throws before any invoke.
  const ai = createAI({
    budget: { perCallUsd: 0.0000001 },
    providers: { anthropic: working("anthropic", "should-not-reach"), p2: working("p2", "nope") },
  });
  await expect(
    ai.chat({
      prompt: "x".repeat(400),
      override: { provider: "anthropic", model: "claude-sonnet-4-6", transport: "http" },
      fallback: [{ provider: "p2", model: "claude-haiku-4-5", transport: "http" }],
    }),
  ).rejects.toThrow(BudgetExceededError);
});
