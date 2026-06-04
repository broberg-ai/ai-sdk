// Shared core for OpenAI-compatible chat APIs. OpenAI (F4.1), DeepInfra (F4.3)
// and OpenRouter (F4.4) all speak this wire format — only base URL, key and a
// couple of headers differ. The adapter uses httpTransport (F2.4) for the wire
// I/O and the F4.5 tool contract for tool round-tripping.
import { httpTransport } from "../transport/http.js";
import { streamTransport } from "../transport/stream.js";
import { toProviderTools, fromProviderToolCall } from "./tools.js";
import { freshUsage } from "../cost/usage.js";
import type {
  ProviderAdapter,
  ChatRequest,
  ChatResult,
  ChatStreamEvent,
  Message,
  ToolCall,
} from "../types.js";

export interface OpenAICompatibleConfig {
  /** Provider name recorded on Usage (e.g. "openai", "deepinfra", "openrouter"). */
  name: string;
  /** Chat completions base, e.g. "https://api.openai.com/v1". */
  baseUrl: string;
  /** Resolved at call time if omitted (env var per provider). */
  apiKey?: string;
  /** Extra headers (e.g. OpenRouter's HTTP-Referer / X-Title). */
  extraHeaders?: Record<string, string>;
  /** Injectable fetch for the streaming path (tests). */
  fetch?: typeof fetch;
  /** OpenRouter ground-truth cost (F010): send `usage:{include:true}` and use the
   *  response's `usage.cost` (USD) as costUsd, falling back to the pricing table.
   *  Only OpenRouter returns this field — openai/deepinfra leave it false. */
  costFromResponseField?: boolean;
}

interface OAToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface OAResponse {
  choices?: { message?: { content?: string | null; tool_calls?: OAToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: unknown;
}

/** SDK message → OpenAI message (string content, or multimodal parts for vision).
 *  Threads the normalized tool form to the wire: a `tool`-role message's
 *  `toolCallId` → `tool_call_id`, and an assistant message's `toolCalls` →
 *  `tool_calls:[{id,type:'function',function:{name,arguments}}]` (F8.3) so a
 *  multi-turn tool conversation round-trips. Exported for serialization tests. */
export function toOpenAIMessage(m: Message): Record<string, unknown> {
  if (typeof m.content === "string") {
    const base: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.toolCallId) base.tool_call_id = m.toolCallId;
    if (m.toolCalls && m.toolCalls.length > 0) {
      base.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }
    return base;
  }
  const content = m.content.map((p) => {
    if (p.type === "text") return { type: "text", text: p.text };
    if (p.type === "video") {
      // F019.3 — OpenRouter video models. `video_url` mirrors `image_url`;
      // VERIFIED live 2026-06-04 against gemma-4 + nvidia-nemotron (both described
      // a real 2MB clip sent inline as a base64 data-URL).
      const url =
        typeof p.video === "string"
          ? p.video
          : `data:${p.mimeType ?? "video/mp4"};base64,${Buffer.from(p.video).toString("base64")}`;
      return { type: "video_url", video_url: { url } };
    }
    const url =
      typeof p.image === "string"
        ? p.image
        : `data:${p.mimeType ?? "image/png"};base64,${Buffer.from(p.image).toString("base64")}`;
    return { type: "image_url", image_url: { url } };
  });
  return { role: m.role, content };
}

export function makeOpenAICompatibleAdapter(config: OpenAICompatibleConfig): ProviderAdapter {
  async function chat(req: ChatRequest): Promise<ChatResult> {
    const apiKey = config.apiKey ?? process.env[`${config.name.toUpperCase()}_API_KEY`];
    if (!apiKey) {
      throw new Error(`${config.name} adapter: API key not set (env ${config.name.toUpperCase()}_API_KEY)`);
    }
    const body: Record<string, unknown> = {
      model: req.spec.model,
      messages: req.messages.map(toOpenAIMessage),
    };
    if (req.tools) body.tools = toProviderTools(req.tools, "openai");
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.responseFormat === "json") body.response_format = { type: "json_object" };
    if (config.costFromResponseField) body.usage = { include: true };

    const res = await httpTransport({
      spec: req.spec,
      http: {
        url: `${config.baseUrl}/chat/completions`,
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...config.extraHeaders,
        },
        body,
      },
    });
    if (!res.ok) {
      throw new Error(`${config.name} ${res.status}: ${JSON.stringify(res.json).slice(0, 300)}`);
    }
    const data = res.json as OAResponse;
    const msg = data.choices?.[0]?.message;
    const text = msg?.content ?? "";
    const toolCalls: ToolCall[] | undefined = msg?.tool_calls?.map((tc) =>
      fromProviderToolCall(tc, "openai"),
    );
    const usage = freshUsage({
      provider: config.name,
      model: req.spec.model,
      transport: "http",
      capability: "chat",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    });
    if (config.costFromResponseField && typeof data.usage?.cost === "number") {
      usage.costUsd = data.usage.cost; // OpenRouter ground-truth beats the estimate
    }
    const result: ChatResult = { text, usage };
    if (toolCalls && toolCalls.length > 0) result.toolCalls = toolCalls;
    return result;
  }

  // Streaming chat (F8.2). Parses the OpenAI chat.completions SSE: content
  // deltas → text events, tool_calls deltas accumulated (index-keyed, arguments
  // string concatenated) → complete tool_call events at end, the include_usage
  // chunk → a usage event, finish_reason → the terminal finish (emitted last so
  // tool_calls + usage precede it).
  async function* chatStream(req: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const apiKey = config.apiKey ?? process.env[`${config.name.toUpperCase()}_API_KEY`];
    if (!apiKey) {
      throw new Error(`${config.name} adapter: API key not set (env ${config.name.toUpperCase()}_API_KEY)`);
    }
    const body: Record<string, unknown> = {
      model: req.spec.model,
      messages: req.messages.map(toOpenAIMessage),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.tools) body.tools = toProviderTools(req.tools, "openai");
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.responseFormat === "json") body.response_format = { type: "json_object" };
    if (config.costFromResponseField) body.usage = { include: true };

    const stream = streamTransport({
      spec: req.spec,
      fetch: config.fetch,
      http: {
        url: `${config.baseUrl}/chat/completions`,
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...config.extraHeaders,
        },
        body,
      },
    });

    // index → accumulated tool call (id/name set once, arguments concatenated).
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | null = null;

    for await (const data of stream) {
      let chunk: OAStreamChunk;
      try {
        chunk = JSON.parse(data) as OAStreamChunk;
      } catch {
        continue; // ignore unparseable keep-alive noise
      }
      const choice = chunk.choices?.[0];
      if (choice) {
        const delta = choice.delta ?? {};
        if (typeof delta.content === "string" && delta.content.length > 0) {
          yield { type: "text", delta: delta.content };
        }
        for (const tc of delta.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const cur = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          toolAcc.set(idx, cur);
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      if (chunk.usage) {
        const usage = freshUsage({
          provider: config.name,
          model: req.spec.model,
          transport: "http",
          capability: "chat",
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        });
        if (config.costFromResponseField && typeof chunk.usage.cost === "number") {
          usage.costUsd = chunk.usage.cost; // OpenRouter ground-truth
        }
        yield { type: "usage", costUsd: usage.costUsd, model: usage.model, usage };
      }
    }

    // Flush accumulated tool calls (complete), then the terminal finish.
    for (const [, t] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      let args: Record<string, unknown> = {};
      try {
        args = t.args ? (JSON.parse(t.args) as Record<string, unknown>) : {};
      } catch {
        args = {};
      }
      yield { type: "tool_call", id: t.id, name: t.name, args };
    }
    yield { type: "finish", reason: mapFinishReason(finishReason) };
  }

  return {
    name: config.name,
    chat,
    chatStream,
    // gpt-4o-class models are multimodal — vision shares the chat path.
    vision: chat,
  };
}

/** OpenAI streaming chunk shape (only the fields we read). */
interface OAStreamChunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/** Map OpenAI finish_reason → the SDK's ChatStreamEvent finish reason. */
function mapFinishReason(reason: string | null): "end_turn" | "tool_calls" | "length" | "stop" {
  switch (reason) {
    case "tool_calls":
      return "tool_calls";
    case "length":
      return "length";
    case "stop":
      return "stop";
    default:
      return "end_turn";
  }
}
