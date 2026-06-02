// Google Gemini adapter (F4.2). generateContent REST API; API key in the query
// param (?key=), not a header. System turns map to systemInstruction; assistant
// maps to role "model". Token counts come from usageMetadata. Tools normalized
// via F4.5. No @google/generative-ai package — plain fetch through httpTransport.
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
  ContentPart,
  ToolCall,
} from "../types.js";

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  inlineData?: { mimeType: string; data: string };
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: unknown;
}

function partsFrom(content: string | ContentPart[]): GeminiPart[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((p): GeminiPart => {
    if (p.type === "text") return { text: p.text };
    const data =
      typeof p.image === "string"
        ? p.image.replace(/^data:[^;]+;base64,/, "")
        : Buffer.from(p.image).toString("base64");
    return { inlineData: { mimeType: p.mimeType ?? "image/png", data } };
  });
}

export function geminiAdapter(
  config: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch } = {},
): ProviderAdapter {
  const baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";

  function resolveKey(): string {
    const apiKey = config.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("gemini adapter: API key not set (env GOOGLE_API_KEY)");
    return apiKey;
  }

  /** Build the generateContent body (shared by the http + stream paths). */
  function buildBody(req: ChatRequest): Record<string, unknown> {
    const systemParts: GeminiPart[] = [];
    const contents: { role: string; parts: GeminiPart[] }[] = [];
    for (const m of req.messages as Message[]) {
      if (m.role === "system") {
        systemParts.push(...partsFrom(m.content));
      } else {
        contents.push({
          role: m.role === "assistant" ? "model" : "user",
          parts: partsFrom(m.content),
        });
      }
    }
    const body: Record<string, unknown> = { contents };
    if (systemParts.length > 0) body.systemInstruction = { parts: systemParts };
    if (req.tools) body.tools = toProviderTools(req.tools, "gemini");
    const genConfig: Record<string, unknown> = {};
    if (req.maxTokens !== undefined) genConfig.maxOutputTokens = req.maxTokens;
    if (req.temperature !== undefined) genConfig.temperature = req.temperature;
    if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig;
    return body;
  }

  async function chat(req: ChatRequest): Promise<ChatResult> {
    const apiKey = resolveKey();
    const body = buildBody(req);

    const res = await httpTransport({
      spec: req.spec,
      http: {
        url: `${baseUrl}/models/${req.spec.model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        headers: { "content-type": "application/json" },
        body,
      },
    });
    if (!res.ok) {
      throw new Error(`gemini ${res.status}: ${JSON.stringify(res.json).slice(0, 300)}`);
    }
    const data = res.json as GeminiResponse;
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => typeof p.text === "string")
      .map((p) => p.text)
      .join("");
    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall)
      .map((p) => fromProviderToolCall({ functionCall: p.functionCall }, "gemini"));

    const usage = freshUsage({
      provider: "gemini",
      model: req.spec.model,
      transport: "http",
      capability: "chat",
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    });
    const result: ChatResult = { text, usage };
    if (toolCalls.length > 0) result.toolCalls = toolCalls;
    return result;
  }

  // Streaming chat (F8.6) over streamGenerateContent?alt=sse. Each SSE chunk is
  // a partial GenerateContentResponse: parts[].text → text events, parts[].
  // functionCall → complete tool_call events (gemini sends each call whole), and
  // the final usageMetadata → a usage event. finishReason maps the terminal.
  async function* chatStream(req: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const apiKey = resolveKey();
    const body = buildBody(req);
    const stream = streamTransport({
      spec: req.spec,
      fetch: config.fetch,
      http: {
        url: `${baseUrl}/models/${req.spec.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
        headers: { "content-type": "application/json" },
        body,
      },
    });

    const toolCalls: ToolCall[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: string | null = null;

    for await (const data of stream) {
      let chunk: GeminiResponse & { candidates?: { finishReason?: string }[] };
      try {
        chunk = JSON.parse(data) as typeof chunk;
      } catch {
        continue;
      }
      const candidate = chunk.candidates?.[0];
      for (const p of candidate?.content?.parts ?? []) {
        if (typeof p.text === "string" && p.text.length > 0) {
          yield { type: "text", delta: p.text };
        } else if (p.functionCall) {
          toolCalls.push(fromProviderToolCall({ functionCall: p.functionCall }, "gemini"));
        }
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      if (chunk.usageMetadata) {
        inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
      }
    }

    for (const tc of toolCalls) {
      yield { type: "tool_call", id: tc.id, name: tc.name, args: tc.arguments };
    }
    const usage = freshUsage({
      provider: "gemini",
      model: req.spec.model,
      transport: "http",
      capability: "chat",
      inputTokens,
      outputTokens,
    });
    yield { type: "usage", costUsd: usage.costUsd, model: usage.model, usage };
    yield {
      type: "finish",
      reason: toolCalls.length > 0 ? "tool_calls" : mapGeminiFinish(finishReason),
    };
  }

  return { name: "gemini", chat, chatStream, vision: chat };
}

/** Map Gemini finishReason → the SDK's ChatStreamEvent finish reason. */
function mapGeminiFinish(reason: string | null): "end_turn" | "tool_calls" | "length" | "stop" {
  switch (reason) {
    case "MAX_TOKENS":
      return "length";
    case "STOP":
      return "end_turn";
    default:
      return reason ? "stop" : "end_turn";
  }
}
