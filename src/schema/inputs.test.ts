import { expect, test } from "bun:test";
import { ZodError } from "zod";
import {
  chatInputSchema,
  imageInputSchema,
  aiConfigSchema,
} from "./inputs.js";
import { createAI as realCreateAI } from "../client.js";
import { stubProviders } from "../providers/stub.js";
const createAI = (cfg: Parameters<typeof realCreateAI>[0] = {}) =>
  realCreateAI({ providers: stubProviders, ...cfg });

test("valid chat input parses cleanly", () => {
  const parsed = chatInputSchema.parse({ prompt: "hello", tier: "fast" });
  expect(parsed.prompt).toBe("hello");
  expect(parsed.tier).toBe("fast");
});

test("chatInputSchema rejects out-of-range temperature", () => {
  expect(() => chatInputSchema.parse({ prompt: "x", temperature: 99 })).toThrow(ZodError);
});

test("chatInputSchema rejects an unknown tier", () => {
  expect(() => chatInputSchema.parse({ prompt: "x", tier: "turbo" })).toThrow(ZodError);
});

test("imageInputSchema rejects a negative width", () => {
  expect(() => imageInputSchema.parse({ prompt: "x", width: -10 })).toThrow(ZodError);
});

test("aiConfigSchema rejects a negative budget ceiling", () => {
  expect(() => aiConfigSchema.parse({ budget: { perCallUsd: -1 } })).toThrow(ZodError);
});

test("client methods validate at the boundary — invalid input rejects with ZodError", async () => {
  const ai = createAI();
  await expect(ai.chat({ prompt: "x", temperature: 50 })).rejects.toThrow(ZodError);
});

test("client methods accept valid input", async () => {
  const ai = createAI();
  const res = await ai.chat({ prompt: "ok", temperature: 0.7 });
  expect(res.text).toContain("ok");
});
