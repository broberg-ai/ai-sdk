import { expect, test } from "bun:test";
import { createAI as realCreateAI } from "./client.js";
import { stubProviders } from "./providers/stub.js";
// All tests here exercise the facade logic, not real providers — route through stubs.
const createAI = (cfg: Parameters<typeof realCreateAI>[0] = {}) =>
  realCreateAI({ providers: stubProviders, ...cfg });
import {
  anthropicApiAdapter,
  anthropicSubprocessAdapter,
  falStubAdapter,
} from "./providers/stub.js";
import type { CostSink, ProviderAdapter, Usage } from "./types.js";

test("createAI({}).chat resolves without throwing (stub response)", async () => {
  const ai = createAI();
  const res = await ai.chat({ prompt: "hi" });
  expect(res.text).toContain("hi");
  expect(res.usage.provider).toBe("mistral"); // F030: default tiers → Mistral EU
  expect(res.usage.capability).toBe("chat");
  expect(res.usage.ts).not.toBe(""); // client stamps ts
});

test("stub adapters satisfy ProviderAdapter", () => {
  const adapters: ProviderAdapter[] = [
    anthropicApiAdapter,
    anthropicSubprocessAdapter,
    falStubAdapter,
  ];
  for (const a of adapters) {
    expect(typeof a.name).toBe("string");
    expect(typeof a.chat === "function" || typeof a.image === "function").toBe(true);
  }
});

test("costSink receives usage after a call; capability + tier stamped", async () => {
  const recorded: Usage[] = [];
  const sink: CostSink = { record: (u) => void recorded.push(u) };
  const ai = createAI({ costSink: sink });
  await ai.chat({ prompt: "x", tier: "fast", purpose: "unit-test" });
  expect(recorded).toHaveLength(1);
  expect(recorded[0]?.capability).toBe("chat");
  expect(recorded[0]?.tier).toBe("fast");
  expect(recorded[0]?.purpose).toBe("unit-test");
});

test("a throwing costSink never crashes the call", async () => {
  const sink: CostSink = {
    record: () => {
      throw new Error("sink is down");
    },
  };
  const ai = createAI({ costSink: sink });
  const res = await ai.chat({ prompt: "still works" });
  expect(res.text).toContain("still works");
});

test("translate routes through chat and tags capability translate", async () => {
  const recorded: Usage[] = [];
  const ai = createAI({ costSink: { record: (u) => void recorded.push(u) } });
  const res = await ai.translate({ text: "hello", to: "Danish" });
  expect(res.text).toBeString();
  expect(recorded[0]?.capability).toBe("translate");
});

test("image uses the fal default route", async () => {
  const ai = createAI();
  const res = await ai.image({ prompt: "a cat" });
  expect(res.url).toContain("stub.fal");
  expect(res.usage.provider).toBe("fal");
});

test("unknown provider override throws a clear error", async () => {
  const ai = createAI();
  await expect(
    ai.chat({ prompt: "x", override: { provider: "nope" } }),
  ).rejects.toThrow(/no provider adapter registered for "nope"/);
});

test("embedding default tier returns one vector per input", async () => {
  const ai = createAI();
  const res = await ai.embedding({ text: ["a", "b"] });
  expect(res.vectors).toHaveLength(2);
});
