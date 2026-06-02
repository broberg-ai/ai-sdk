// Shared core for OpenAI-compatible chat APIs. OpenAI (F4.1), DeepInfra (F4.3)
// and OpenRouter (F4.4) all speak this wire format — only base URL, key and a
// couple of headers differ. The adapter uses httpTransport (F2.4) for the wire
// I/O and the F4.5 tool contract for tool round-tripping.
import { httpTransport } from "../transport/http.js";
import { toProviderTools, fromProviderToolCall } from "./tools.js";
import { freshUsage } from "../cost/usage.js";
import type {
  ProviderAdapter,
  ChatRequest,
  ChatResult,
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
}

interface OAToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface OAResponse {
  choices?: { message?: { content?: string | null; tool_calls?: OAToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: unknown;
}

/** SDK message → OpenAI message (string content, or multimodal parts for vision). */
function toOpenAIMessage(m: Message): Record<string, unknown> {
  if (typeof m.content === "string") {
    const base: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.toolCallId) base.tool_call_id = m.toolCallId;
    return base;
  }
  const content = m.content.map((p) => {
    if (p.type === "text") return { type: "text", text: p.text };
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
    const result: ChatResult = { text, usage };
    if (toolCalls && toolCalls.length > 0) result.toolCalls = toolCalls;
    return result;
  }

  return {
    name: config.name,
    chat,
    // gpt-4o-class models are multimodal — vision shares the chat path.
    vision: chat,
  };
}
