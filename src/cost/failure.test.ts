// F071.1 — failed calls reach upmetrics with status and error code.
import { expect, test } from "bun:test";
import { createAI } from "../client.js";
import { upmetricsSink } from "./sinks/upmetrics.js";
import { classifyFailure } from "./failure.js";
import type { ProviderAdapter } from "../types.js";

const SMART = { smart: { provider: "a", model: "m-a", transport: "http" as const } };

function failing(status: number): ProviderAdapter {
  return { name: "a", chat: async () => { throw new Error(`a ${status}: denied`); } };
}
function working(name: string): ProviderAdapter {
  return {
    name,
    chat: async (req) => ({
      text: "ok",
      usage: { provider: name, model: req.spec.model, transport: "http", inputTokens: 1, outputTokens: 1, costUsd: 0.001, ts: "" } as never,
    }),
  };
}
function captureSink() {
  const bodies: Record<string, unknown>[] = [];
  const sink = upmetricsSink({
    baseUrl: "https://u.test",
    apiKey: "uk",
    agentName: "t",
    retry: false,
    fetch: (async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  return { bodies, sink };
}

test("classifyFailure reads the status adapters put in their message", () => {
  expect(classifyFailure(new Error("openai 401: Incorrect API key"))).toEqual({ errorCode: "401", errorKind: "auth" });
  expect(classifyFailure(new Error("vertex animate 404: {"))).toEqual({ errorCode: "404", errorKind: "not_found" });
  expect(classifyFailure(new Error("mistral 429: slow down"))).toEqual({ errorCode: "429", errorKind: "rate_limit" });
  expect(classifyFailure(new Error("anthropic 529: overloaded"))).toEqual({ errorCode: "529", errorKind: "server" });
  expect(classifyFailure(Object.assign(new Error("x"), { name: "AbortError" }))).toEqual({ errorCode: "timeout", errorKind: "timeout" });
  // a model name with digits is not a status
  expect(classifyFailure(new Error("gpt-4o-2024 broke"))).toEqual({ errorCode: "unknown", errorKind: "other" });
});

test("a 401 produces ONE upmetrics row: status error, error_code 401, error_kind auth, cost 0", async () => {
  const { bodies, sink } = captureSink();
  const ai = createAI({ providers: { a: failing(401) }, defaults: SMART, costSink: sink });
  await expect(ai.chat({ prompt: "hej", tier: "smart" })).rejects.toThrow(/401/);
  expect(bodies).toHaveLength(1);
  const b = bodies[0]!;
  expect(b.status).toBe("error");
  expect(b.provider).toBe("a");
  expect(b.model).toBe("m-a");
  expect(b.cost_usd).toBe(0);
  const tags = b.tags as Record<string, string>;
  expect(tags.error_code).toBe("401");
  expect(tags.error_kind).toBe("auth");
  expect(tags.capability).toBe("chat");
});

test("primary fails (503), fallback works → two rows: error/server then success", async () => {
  const { bodies, sink } = captureSink();
  const ai = createAI({ providers: { a: failing(503), b: working("b") }, defaults: SMART, costSink: sink });
  const r = await ai.chat({ prompt: "hej", tier: "smart", fallback: [{ provider: "b", model: "m-b", transport: "http" }] });
  expect(r.text).toBe("ok");
  expect(bodies.map((b) => b.status)).toEqual(["error", "success"]);
  expect((bodies[0]!.tags as Record<string, string>).error_kind).toBe("server");
  expect(bodies[1]!.provider).toBe("b");
});

test("a sink whose recordFailure throws does not break the call; a sink without it sees no failures", async () => {
  const thrower = { record: () => {}, recordFailure: () => { throw new Error("sink down"); } };
  const ai1 = createAI({ providers: { a: failing(503), b: working("b") }, defaults: SMART, costSink: thrower });
  expect((await ai1.chat({ prompt: "hej", tier: "smart", fallback: [{ provider: "b", model: "m-b", transport: "http" }] })).text).toBe("ok");

  const seen: unknown[] = [];
  const plain = { record: (u: unknown) => void seen.push(u) };
  const ai2 = createAI({ providers: { a: failing(503), b: working("b") }, defaults: SMART, costSink: plain });
  await ai2.chat({ prompt: "hej", tier: "smart", fallback: [{ provider: "b", model: "m-b", transport: "http" }] });
  expect(seen).toHaveLength(1); // only the success
});
