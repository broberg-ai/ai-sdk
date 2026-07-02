import { expect, test } from "bun:test";
import { createAI } from "../client.js";
import { freshUsage } from "../cost/usage.js";
import type { ProviderAdapter, ChatResult } from "../types.js";

// A provider that records the model it was actually dispatched with.
function recording(name: string, seen: { model?: string }): ProviderAdapter {
  return {
    name,
    chat: async (req): Promise<ChatResult> => {
      seen.model = req.spec.model;
      return {
        text: "ok",
        usage: freshUsage({ provider: name, model: req.spec.model, transport: "http", capability: "chat", inputTokens: 1, outputTokens: 1 }),
      };
    },
  };
}

test("autoResolve on: a suspended primary model is swapped to the configured fallback (F022)", async () => {
  const seen: { model?: string } = {};
  const ai = createAI({
    providers: { anthropic: recording("anthropic", seen) },
    availability: { autoResolve: true, fallback: "claude-opus-4-8" },
  });
  await ai.chat({ prompt: "hi", override: { provider: "anthropic", model: "claude-mythos-5", transport: "http" } });
  expect(seen.model).toBe("claude-opus-4-8"); // mythos suspended → opus dispatched
});

test("autoResolve OFF (default): a suspended model is dispatched unchanged — byte-identical", async () => {
  const seen: { model?: string } = {};
  const ai = createAI({ providers: { anthropic: recording("anthropic", seen) } });
  await ai.chat({ prompt: "hi", override: { provider: "anthropic", model: "claude-mythos-5", transport: "http" } });
  expect(seen.model).toBe("claude-mythos-5"); // no gate → unchanged
});

test("autoResolve on: an available primary model is left untouched (no false swap)", async () => {
  const seen: { model?: string } = {};
  const ai = createAI({
    providers: { anthropic: recording("anthropic", seen) },
    availability: { autoResolve: true, fallback: "claude-haiku-4-5" },
  });
  await ai.chat({ prompt: "hi", override: { provider: "anthropic", model: "claude-opus-4-8", transport: "http" } });
  expect(seen.model).toBe("claude-opus-4-8"); // opus available → no swap
});
