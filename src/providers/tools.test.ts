import { expect, test } from "bun:test";
import { toProviderTools, fromProviderToolCall } from "./tools.js";
import type { Tool } from "../types.js";

const tool: Tool = {
  name: "get_weather",
  description: "Get weather for a city",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

test("toProviderTools — OpenAI-compatible (openai/deepinfra/openrouter)", () => {
  for (const p of ["openai", "deepinfra", "openrouter"]) {
    const out = toProviderTools([tool], p) as { type: string; function: { name: string } }[];
    expect(out[0]?.type).toBe("function");
    expect(out[0]?.function.name).toBe("get_weather");
  }
});

test("toProviderTools — Gemini functionDeclarations", () => {
  const out = toProviderTools([tool], "gemini") as { functionDeclarations: { name: string }[] }[];
  expect(out[0]?.functionDeclarations[0]?.name).toBe("get_weather");
});

test("toProviderTools — Anthropic input_schema", () => {
  const out = toProviderTools([tool], "anthropic") as { name: string; input_schema: unknown }[];
  expect(out[0]?.name).toBe("get_weather");
  expect(out[0]?.input_schema).toEqual(tool.parameters);
});

test("fromProviderToolCall — OpenAI (arguments is a JSON string)", () => {
  const tc = fromProviderToolCall(
    { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Aalborg"}' } },
    "openrouter",
  );
  expect(tc).toEqual({ id: "call_1", name: "get_weather", arguments: { city: "Aalborg" } });
});

test("fromProviderToolCall — Gemini (args object, no id)", () => {
  const tc = fromProviderToolCall(
    { functionCall: { name: "get_weather", args: { city: "Blokhus" } } },
    "gemini",
  );
  expect(tc).toEqual({ id: "", name: "get_weather", arguments: { city: "Blokhus" } });
});

test("fromProviderToolCall — Anthropic (tool_use block)", () => {
  const tc = fromProviderToolCall(
    { type: "tool_use", id: "toolu_9", name: "get_weather", input: { city: "Stockholm" } },
    "anthropic",
  );
  expect(tc).toEqual({ id: "toolu_9", name: "get_weather", arguments: { city: "Stockholm" } });
});

test("round-trip: tool → provider request → simulated call → ToolCall (each provider)", () => {
  // OpenAI family
  const oaTools = toProviderTools([tool], "openai") as { function: { name: string } }[];
  const oaCall = fromProviderToolCall(
    { id: "c1", function: { name: oaTools[0]!.function.name, arguments: "{}" } },
    "openai",
  );
  expect(oaCall.name).toBe("get_weather");

  // Gemini
  const gTools = toProviderTools([tool], "gemini") as { functionDeclarations: { name: string }[] }[];
  const gCall = fromProviderToolCall(
    { functionCall: { name: gTools[0]!.functionDeclarations[0]!.name, args: {} } },
    "gemini",
  );
  expect(gCall.name).toBe("get_weather");

  // Anthropic
  const aTools = toProviderTools([tool], "anthropic") as { name: string }[];
  const aCall = fromProviderToolCall(
    { type: "tool_use", id: "t1", name: aTools[0]!.name, input: {} },
    "anthropic",
  );
  expect(aCall.name).toBe("get_weather");
});

test("fromProviderToolCall tolerates malformed OpenAI arguments", () => {
  const tc = fromProviderToolCall(
    { id: "x", function: { name: "f", arguments: "not json" } },
    "openai",
  );
  expect(tc.arguments).toEqual({});
});
