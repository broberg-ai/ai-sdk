import { expect, test } from "bun:test";
import { computeCost, freshUsage } from "./usage.js";
import { createAI as realCreateAI } from "../client.js";
import { stubProviders } from "../providers/stub.js";
const createAI = (cfg: Parameters<typeof realCreateAI>[0] = {}) =>
  realCreateAI({ providers: stubProviders, ...cfg });

test("computeCost returns 0 for an unpriced/unknown model (never throws)", () => {
  expect(computeCost("acme", "imaginary-model-v9", 1000, 500)).toBe(0);
});

test("freshUsage builds a complete Usage; subprocess pins cost 0 + flag", () => {
  const u = freshUsage({
    provider: "anthropic",
    model: "claude-haiku-4-5",
    transport: "subprocess",
    capability: "chat",
    inputTokens: 100,
    outputTokens: 20,
    subprocess: true,
  });
  expect(u.costUsd).toBe(0);
  expect(u.subprocess).toBe(true);
  expect(u.inputTokens).toBe(100);
  expect(u.cacheReadTokens).toBe(0);
});

test("client stamps real latencyMs (a finite number >= 0)", async () => {
  const ai = createAI();
  const res = await ai.chat({ prompt: "time me" });
  expect(typeof res.usage.latencyMs).toBe("number");
  expect(Number.isFinite(res.usage.latencyMs)).toBe(true);
  expect(res.usage.latencyMs).toBeGreaterThanOrEqual(0);
});

test("subprocess-tier chat carries subprocess flag through to usage", async () => {
  const ai = createAI();
  // 'cheap' tier resolves to anthropic/subprocess, but the default registry maps
  // provider 'anthropic' to the http stub — so assert via the subprocess adapter directly.
  const { anthropicSubprocessAdapter } = await import("../providers/stub.js");
  const r = await anthropicSubprocessAdapter.chat!({
    messages: [{ role: "user", content: "hi" }],
    spec: { provider: "anthropic", model: "claude-haiku-4-5", transport: "subprocess" },
  });
  expect(r.usage.subprocess).toBe(true);
});
