// Anthropic adapter (F4.6) — the real one (F2.5 shipped only a stub). Two
// transports: http (api.anthropic.com/v1/messages) and subprocess (claude -p,
// Max plan, costUsd 0). Critical for the xrt81 vision pilot. Tools normalized
// via F4.5. No @anthropic-ai/sdk package — plain fetch through httpTransport.
import { httpTransport } from "../transport/http.js";
import { subprocessTransport } from "../transport/subprocess.js";
import { streamTransport } from "../transport/stream.js";
import { toProviderTools, fromProviderToolCall } from "./tools.js";
import { freshUsage } from "../cost/usage.js";
import type {
  ProviderAdapter,
  ChatRequest,
  ChatResult,
  ChatStreamEvent,
  Message,
  ContentPart,
  ToolCall,
} from "../types.js";

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}
interface AnthropicResponse {
  content?: AnthropicBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: unknown;
}

function contentBlocks(content: string | ContentPart[]): unknown {
  if (typeof content === "string") return content;
  return content.map((p) => {
    if (p.type === "text") return { type: "text", text: p.text };
    if (typeof p.image === "string" && /^https?:\/\//.test(p.image)) {
      return { type: "image", source: { type: "url", url: p.image } };
    }
    const data =
      typeof p.image === "string"
        ? p.image.replace(/^data:[^;]+;base64,/, "")
        : Buffer.from(p.image).toString("base64");
    return {
      type: "image",
      source: { type: "base64", media_type: p.mimeType ?? "image/png", data },
    };
  });
}

/** Flatten messages to a single prompt for the subprocess (claude -p) path. */
function flattenForSubprocess(messages: Message[]): { prompt: string; system?: string } {
  const sys: string[] = [];
  const turns: string[] = [];
  for (const m of messages) {
    const text =
      typeof m.content === "string"
        ? m.content
        : m.content.map((p) => (p.type === "text" ? p.text : "[image]")).join(" ");
    if (m.role === "system") sys.push(text);
    else turns.push(`${m.role}: ${text}`);
  }
  return { prompt: turns.join("\n\n"), system: sys.length ? sys.join("\n") : undefined };
}

export function anthropicAdapter(
  config: { apiKey?: string; baseUrl?: string; anthropicVersion?: string; fetch?: typeof fetch } = {},
): ProviderAdapter {
  const baseUrl = config.baseUrl ?? "https://api.anthropic.com";
  const version = config.anthropicVersion ?? "2023-06-01";

  /** Build the /v1/messages body (shared by the http + stream paths). */
  function buildBody(req: ChatRequest): Record<string, unknown> {
    const system: string[] = [];
    const messages: { role: string; content: unknown }[] = [];
    for (const m of req.messages as Message[]) {
      if (m.role === "system") {
        system.push(typeof m.content === "string" ? m.content : "");
      } else {
        messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: contentBlocks(m.content) });
      }
    }
    const body: Record<string, unknown> = {
      model: req.spec.model,
      max_tokens: req.maxTokens ?? 1024, // Anthropic requires max_tokens
      messages,
    };
    if (system.length > 0) body.system = system.join("\n");
    if (req.tools) body.tools = toProviderTools(req.tools, "anthropic");
    if (req.temperature !== undefined) body.temperature = req.temperature;
    return body;
  }

  function apiKeyOrThrow(): string {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("anthropic adapter: API key not set (env ANTHROPIC_API_KEY)");
    return apiKey;
  }

  async function chatHttp(req: ChatRequest): Promise<ChatResult> {
    const apiKey = apiKeyOrThrow();
    const body = buildBody(req);

    const res = await httpTransport({
      spec: req.spec,
      http: {
        url: `${baseUrl}/v1/messages`,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": version,
        },
        body,
      },
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${JSON.stringify(res.json).slice(0, 300)}`);

    const data = res.json as AnthropicResponse;
    const blocks = data.content ?? [];
    const text = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    const toolCalls: ToolCall[] = blocks
      .filter((b) => b.type === "tool_use")
      .map((b) => fromProviderToolCall(b, "anthropic"));

    const usage = freshUsage({
      provider: "anthropic",
      model: req.spec.model,
      transport: "http",
      capability: "chat",
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: data.usage?.cache_creation_input_tokens ?? 0,
    });
    const result: ChatResult = { text, usage };
    if (toolCalls.length > 0) result.toolCalls = toolCalls;
    return result;
  }

  async function chatSubprocess(req: ChatRequest): Promise<ChatResult> {
    const { prompt, system } = flattenForSubprocess(req.messages as Message[]);
    const r = await subprocessTransport({ spec: req.spec, subprocess: { prompt, systemPrompt: system } });
    const usage = freshUsage({
      provider: "anthropic",
      model: req.spec.model,
      transport: "subprocess",
      capability: "chat",
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheCreationTokens: r.cacheCreationTokens,
      subprocess: true,
    });
    return { text: r.text, usage };
  }

  async function chat(req: ChatRequest): Promise<ChatResult> {
    return req.spec.transport === "subprocess" ? chatSubprocess(req) : chatHttp(req);
  }

  // Streaming chat (F8.4) over the native /v1/messages SSE. Maps
  // content_block_delta(text_delta) → text events, accumulates tool_use blocks
  // (id/name from content_block_start, input from input_json_delta) → complete
  // tool_call events, and reads usage from message_start + message_delta. Only
  // the http transport streams — `claude -p` subprocess is one-shot.
  async function* chatStream(req: ChatRequest): AsyncIterable<ChatStreamEvent> {
    if (req.spec.transport === "subprocess") {
      throw new Error("anthropic adapter: streaming is not supported over the subprocess transport");
    }
    const apiKey = apiKeyOrThrow();
    const body = { ...buildBody(req), stream: true };
    const stream = streamTransport({
      spec: req.spec,
      fetch: config.fetch,
      http: {
        url: `${baseUrl}/v1/messages`,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": version,
        },
        body,
      },
    });

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let stopReason: string | null = null;
    // index → accumulated tool_use block (input_json_delta fragments concatenated).
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();

    for await (const data of stream) {
      let ev: AnthropicStreamEvent;
      try {
        ev = JSON.parse(data) as AnthropicStreamEvent;
      } catch {
        continue;
      }
      switch (ev.type) {
        case "message_start": {
          const u = ev.message?.usage;
          inputTokens = u?.input_tokens ?? 0;
          cacheReadTokens = u?.cache_read_input_tokens ?? 0;
          cacheCreationTokens = u?.cache_creation_input_tokens ?? 0;
          break;
        }
        case "content_block_start": {
          if (ev.content_block?.type === "tool_use" && ev.index !== undefined) {
            toolBlocks.set(ev.index, {
              id: ev.content_block.id ?? "",
              name: ev.content_block.name ?? "",
              json: "",
            });
          }
          break;
        }
        case "content_block_delta": {
          const d = ev.delta;
          if (d?.type === "text_delta" && d.text) {
            yield { type: "text", delta: d.text };
          } else if (d?.type === "input_json_delta" && d.partial_json && ev.index !== undefined) {
            const b = toolBlocks.get(ev.index);
            if (b) b.json += d.partial_json;
          }
          break;
        }
        case "message_delta": {
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
          if (ev.usage?.output_tokens !== undefined) outputTokens = ev.usage.output_tokens;
          break;
        }
        default:
          break; // content_block_stop / message_stop / ping
      }
    }

    for (const [, b] of [...toolBlocks.entries()].sort((a, c) => a[0] - c[0])) {
      let args: Record<string, unknown> = {};
      try {
        args = b.json ? (JSON.parse(b.json) as Record<string, unknown>) : {};
      } catch {
        args = {};
      }
      yield { type: "tool_call", id: b.id, name: b.name, args };
    }
    const usage = freshUsage({
      provider: "anthropic",
      model: req.spec.model,
      transport: "http",
      capability: "chat",
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
    });
    yield { type: "usage", costUsd: usage.costUsd, model: usage.model, usage };
    yield { type: "finish", reason: mapAnthropicStop(stopReason) };
  }

  return { name: "anthropic", chat, chatStream, vision: chat };
}

/** Anthropic Messages SSE event (only the fields we read). */
interface AnthropicStreamEvent {
  type: string;
  index?: number;
  message?: {
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
}

/** Map Anthropic stop_reason → the SDK's ChatStreamEvent finish reason. */
function mapAnthropicStop(reason: string | null): "end_turn" | "tool_calls" | "length" | "stop" {
  switch (reason) {
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    case "stop_sequence":
      return "stop";
    default:
      return "end_turn";
  }
}
