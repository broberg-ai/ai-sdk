import { expect, test } from "bun:test";
import { discordSink } from "./discord.js";
import type { Usage } from "../../types.js";

const usage = (over: Partial<Usage> = {}): Usage => ({
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  transport: "http",
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0.01,
  latencyMs: 800,
  capability: "chat",
  ts: "2026-06-02T00:00:00.000Z",
  ...over,
});

function capture() {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(init!.body as string) });
    return new Response("", { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("posts an embed with provider/model/cost/tokens/latency fields", async () => {
  const { calls, fetchImpl } = capture();
  const sink = discordSink({ webhookUrl: "https://discord/webhook", fetch: fetchImpl });
  await sink.record(usage());
  expect(calls).toHaveLength(1);
  const embed = (calls[0]!.body as { embeds: { fields: { name: string; value: string }[] }[] })
    .embeds[0]!;
  const names = embed.fields.map((f) => f.name);
  expect(names).toEqual(["Provider", "Model", "Transport", "Cost", "Tokens", "Latency"]);
  expect(embed.fields.find((f) => f.name === "Cost")?.value).toBe("$0.010000");
});

test("skips paid calls below minUsd", async () => {
  const { calls, fetchImpl } = capture();
  const sink = discordSink({ webhookUrl: "https://d", minUsd: 0.05, fetch: fetchImpl });
  await sink.record(usage({ costUsd: 0.001 }));
  expect(calls).toHaveLength(0);
});

test("subprocess calls always post and show 'Max plan (free)'", async () => {
  const { calls, fetchImpl } = capture();
  const sink = discordSink({ webhookUrl: "https://d", minUsd: 1.0, fetch: fetchImpl });
  await sink.record(usage({ subprocess: true, costUsd: 0, transport: "subprocess" }));
  expect(calls).toHaveLength(1);
  const embed = (calls[0]!.body as { embeds: { fields: { name: string; value: string }[] }[] })
    .embeds[0]!;
  expect(embed.fields.find((f) => f.name === "Cost")?.value).toBe("Max plan (free)");
});

test("network error is swallowed (surfaced via onError)", async () => {
  const errors: unknown[] = [];
  const failing = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
  const sink = discordSink({ webhookUrl: "https://d", fetch: failing, onError: (e) => errors.push(e) });
  await expect(sink.record(usage())).resolves.toBeUndefined();
  expect(errors).toHaveLength(1);
});
