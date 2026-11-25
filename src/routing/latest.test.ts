// F096.1 — «LATEST» routes: ai-sdk owns «what is newest»; consumers name a family.
import { expect, test } from "bun:test";
import { createAI } from "../client.js";
import { LATEST, listLatest, resolveLatest } from "./latest.js";
import { getPrice } from "../cost/pricing.js";
import { listModels } from "../availability/resolve.js";
import type { ProviderAdapter } from "../types.js";

function spy(name: string): { adapter: ProviderAdapter; seen: { provider: string; model: string }[] } {
  const seen: { provider: string; model: string }[] = [];
  const adapter: ProviderAdapter = {
    name,
    async chat(req) {
      seen.push({ provider: req.spec.provider, model: req.spec.model });
      return { text: "ok", usage: { provider: req.spec.provider, model: req.spec.model, transport: "http", inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 0, capability: "chat", ts: "" } as never };
    },
  };
  return { adapter, seen };
}

test("F096 every family alias (model only, no provider) routes to ai-sdk's pinned model; usage.model is the dated id", async () => {
  const providers = Object.fromEntries(["anthropic", "mistral", "openrouter"].map((p) => [p, spy(p)]));
  const ai = createAI({ costSink: null, providers: Object.fromEntries(Object.entries(providers).map(([k, v]) => [k, v.adapter])) });
  for (const e of LATEST) {
    const r = await ai.chat({ prompt: "x", override: { model: e.alias } });
    expect({ alias: e.alias, provider: r.usage.provider, model: r.usage.model }).toEqual({ alias: e.alias, provider: e.provider, model: e.model });
  }
  expect(providers.openrouter!.seen.map((s) => s.model)).toEqual(["anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "deepseek/deepseek-v4-flash-0731"]);
});

test("F096 a provider-native id WITH its provider is untouched — mistral-large-latest still goes to Mistral as written", async () => {
  const m = spy("mistral");
  const ai = createAI({ costSink: null, providers: { mistral: m.adapter } });
  await ai.chat({ prompt: "x", override: { provider: "mistral", model: "mistral-large-latest" }, allowFloating: true });
  expect(m.seen).toEqual([{ provider: "mistral", model: "mistral-large-latest" }]);
});

test("F096 an unknown *-latest without a provider fails closed and lists the families", async () => {
  const ai = createAI({ costSink: null, providers: { mistral: spy("mistral").adapter } });
  const msg = await ai.chat({ prompt: "x", override: { model: "claude-sonet-latest" } }).then(() => "resolved", (e: Error) => e.message);
  expect(msg).toContain('"claude-sonet-latest" is not a LATEST family');
  for (const e of LATEST) expect(msg).toContain(e.alias);
});

test("F096 every pinned model has a price row and a registry row; listLatest/resolveLatest expose them", () => {
  const models = listModels();
  for (const e of LATEST) {
    expect({ alias: e.alias, priced: !!getPrice(e.provider, e.model) }).toEqual({ alias: e.alias, priced: true });
    expect({ alias: e.alias, inRegistry: models.some((m) => m.id === e.model && m.provider === e.provider) }).toEqual({ alias: e.alias, inRegistry: true });
    expect(e.model.endsWith("-latest")).toBe(false); // never a floating id underneath
    expect(e.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
  expect(listLatest().map((e) => e.alias)).toEqual(LATEST.map((e) => e.alias));
  expect(resolveLatest("claude-opus-latest")?.model).toBe("anthropic/claude-opus-5.5");
  expect(resolveLatest("nope-latest")).toBeUndefined();
});
