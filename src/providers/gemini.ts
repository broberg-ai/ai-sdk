// Google Gemini adapter (F4.2). generateContent REST API; API key in the query
// param (?key=), not a header. System turns map to systemInstruction; assistant
// maps to role "model". Token counts come from usageMetadata. Tools normalized
// via F4.5. No @google/generative-ai package — plain fetch through httpTransport.
import { httpTransport } from "../transport/http.js";
import { toProviderTools, fromProviderToolCall } from "./tools.js";
import { freshUsage } from "../cost/usage.js";
import type {
  ProviderAdapter,
  ChatRequest,
  ChatResult,
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
  config: { apiKey?: string; baseUrl?: string } = {},
): ProviderAdapter {
  const baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";

  async function chat(req: ChatRequest): Promise<ChatResult> {
    const apiKey = config.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("gemini adapter: API key not set (env GOOGLE_API_KEY)");
    }

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

  return { name: "gemini", chat, vision: chat };
}
