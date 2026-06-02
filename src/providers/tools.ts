// Cross-provider tool/function-calling normalization. The SDK speaks one Tool /
// ToolCall shape; each provider has its own. toProviderTools builds the request
// tools array; fromProviderToolCall parses one tool-call out of a response.
// OpenAI, DeepInfra and OpenRouter share the OpenAI-compatible format.
import type { Tool, ToolCall } from "../types.js";

type ToolProvider = "openai" | "deepinfra" | "openrouter" | "gemini" | "anthropic";

function family(provider: string): ToolProvider {
  if (provider === "gemini" || provider === "google") return "gemini";
  if (provider === "anthropic") return "anthropic";
  // openai, deepinfra, openrouter — all OpenAI-compatible
  return "openai";
}

/** Convert SDK tools to a provider's request format. */
export function toProviderTools(tools: Tool[], provider: string): unknown {
  switch (family(provider)) {
    case "openai":
      return tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    case "gemini":
      return [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    case "anthropic":
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    default:
      throw new Error(`toProviderTools: unsupported provider family for "${provider}"`);
  }
}

/** Parse a single provider-shaped tool call back into the SDK ToolCall shape. */
export function fromProviderToolCall(raw: unknown, provider: string): ToolCall {
  const r = raw as Record<string, unknown>;
  switch (family(provider)) {
    case "openai": {
      // { id, type:"function", function:{ name, arguments:"<json>" } }
      const fn = (r.function ?? {}) as { name?: string; arguments?: string };
      return {
        id: typeof r.id === "string" ? r.id : "",
        name: fn.name ?? "",
        arguments: parseArgs(fn.arguments),
      };
    }
    case "gemini": {
      // { functionCall:{ name, args } } or { name, args }
      const fc = (r.functionCall ?? r) as { name?: string; args?: unknown };
      return {
        id: "", // Gemini function calls have no id
        name: fc.name ?? "",
        arguments: (fc.args as Record<string, unknown>) ?? {},
      };
    }
    case "anthropic": {
      // { type:"tool_use", id, name, input }
      return {
        id: typeof r.id === "string" ? r.id : "",
        name: typeof r.name === "string" ? r.name : "",
        arguments: (r.input as Record<string, unknown>) ?? {},
      };
    }
    default:
      throw new Error(`fromProviderToolCall: unsupported provider family for "${provider}"`);
  }
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}
