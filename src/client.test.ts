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

// F034 — cost-tracking on by DEFAULT. These seal the exact fleet-wide break:
// a call-site that passes NO costSink must still report (via env auto-wiring),
// so Mistral spend stops being invisible in upmetrics.
test("default cost-tracking: no explicit sink + UPMETRICS_API_KEY env → auto-wires upmetrics POST", async () => {
  const prev = { key: process.env.UPMETRICS_API_KEY, name: process.env.UPMETRICS_AGENT_NAME, fetch: globalThis.fetch };
  const posts: { url: string; body: any }[] = [];
  process.env.UPMETRICS_API_KEY = "uk_test";
  process.env.UPMETRICS_AGENT_NAME = "ai-sdk-test";
  globalThis.fetch = (async (url: any, init: any) => {
    posts.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  try {
    const ai = createAI(); // NO costSink passed — the drifting call-site
    await ai.chat({ prompt: "x", tier: "fast" });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe("https://upmetrics.org/api/agent");
    expect(posts[0]?.body.agent_name).toBe("ai-sdk-test");
    expect(posts[0]?.body.mode).toBe("record");
  } finally {
    globalThis.fetch = prev.fetch;
    prev.key === undefined ? delete process.env.UPMETRICS_API_KEY : (process.env.UPMETRICS_API_KEY = prev.key);
    prev.name === undefined ? delete process.env.UPMETRICS_AGENT_NAME : (process.env.UPMETRICS_AGENT_NAME = prev.name);
  }
});

test("default cost-tracking is provider-agnostic: a NON-mistral (anthropic) call also POSTs", async () => {
  const prev = { key: process.env.UPMETRICS_API_KEY, name: process.env.UPMETRICS_AGENT_NAME, fetch: globalThis.fetch };
  const posts: { body: any }[] = [];
  process.env.UPMETRICS_API_KEY = "uk_test";
  process.env.UPMETRICS_AGENT_NAME = "ai-sdk-test";
  globalThis.fetch = (async (_url: any, init: any) => {
    posts.push({ body: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  try {
    const ai = createAI(); // NO costSink
    await ai.chat({ prompt: "x", override: { provider: "anthropic", model: "claude-x", transport: "http" } });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.provider).toBe("anthropic"); // not mistral — every provider is tracked
  } finally {
    globalThis.fetch = prev.fetch;
    prev.key === undefined ? delete process.env.UPMETRICS_API_KEY : (process.env.UPMETRICS_API_KEY = prev.key);
    prev.name === undefined ? delete process.env.UPMETRICS_AGENT_NAME : (process.env.UPMETRICS_AGENT_NAME = prev.name);
  }
});

test("ship-dark: no explicit sink + no UPMETRICS_API_KEY → no POST, call still works", async () => {
  const prev = { key: process.env.UPMETRICS_API_KEY, fetch: globalThis.fetch };
  let posted = false;
  delete process.env.UPMETRICS_API_KEY;
  globalThis.fetch = (async () => {
    posted = true;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  try {
    const res = await createAI().chat({ prompt: "works" });
    expect(res.text).toContain("works");
    expect(posted).toBe(false);
  } finally {
    globalThis.fetch = prev.fetch;
    if (prev.key !== undefined) process.env.UPMETRICS_API_KEY = prev.key;
  }
});

test("explicit config.costSink always wins — env auto-wiring is skipped", async () => {
  const prev = { key: process.env.UPMETRICS_API_KEY, fetch: globalThis.fetch };
  let posted = false;
  process.env.UPMETRICS_API_KEY = "uk_test";
  globalThis.fetch = (async () => {
    posted = true;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const recorded: Usage[] = [];
  try {
    const ai = createAI({ costSink: { record: (u) => void recorded.push(u) } });
    await ai.chat({ prompt: "x" });
    expect(recorded).toHaveLength(1);
    expect(posted).toBe(false); // upmetrics NOT auto-wired when an explicit sink is given
  } finally {
    globalThis.fetch = prev.fetch;
    prev.key === undefined ? delete process.env.UPMETRICS_API_KEY : (process.env.UPMETRICS_API_KEY = prev.key);
  }
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
