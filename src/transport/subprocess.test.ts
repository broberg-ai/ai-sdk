import { expect, test } from "bun:test";
import { parseClaudeCliJson } from "./subprocess.js";

test("parseClaudeCliJson extracts text + token usage, pins costUsd 0 + subprocess true", () => {
  const raw = JSON.stringify({
    type: "result",
    subtype: "success",
    result: "hello from claude",
    usage: {
      input_tokens: 120,
      output_tokens: 45,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 200,
    },
    total_cost_usd: 0.0123, // CLI reports it; we deliberately ignore — Max plan is free to us
  });
  const r = parseClaudeCliJson(raw);
  expect(r.text).toBe("hello from claude");
  expect(r.inputTokens).toBe(120);
  expect(r.outputTokens).toBe(45);
  expect(r.cacheCreationTokens).toBe(10);
  expect(r.cacheReadTokens).toBe(200);
  expect(r.costUsd).toBe(0);
  expect(r.subprocess).toBe(true);
});

test("parseClaudeCliJson tolerates missing usage", () => {
  const r = parseClaudeCliJson(JSON.stringify({ result: "x" }));
  expect(r.inputTokens).toBe(0);
  expect(r.outputTokens).toBe(0);
  expect(r.costUsd).toBe(0);
});

test("parseClaudeCliJson throws on non-JSON output", () => {
  expect(() => parseClaudeCliJson("not json at all")).toThrow(/could not parse/);
});
