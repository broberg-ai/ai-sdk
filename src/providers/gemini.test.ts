import { expect, test, afterEach } from "bun:test";
import { geminiAdapter } from "./gemini.js";
import type { ChatRequest } from "../types.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(response: unknown, status = 200) {
  const seen: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(init!.body as string) });
    return new Response(JSON.stringify(response), { status });
  }) as unknown as typeof fetch;
  return seen;
}

const req: ChatRequest = {
  messages: [
    { role: "system", content: "You are terse." },
    { role: "user", content: "Hello" },
  ],
  spec: { provider: "gemini", model: "gemini-2.5-flash", transport: "http" },
};

test("geminiAdapter satisfies ProviderAdapter", () => {
  const a = geminiAdapter({ apiKey: "k" });
  expect(a.name).toBe("gemini");
  expect(typeof a.chat).toBe("function");
});

test("chat() calls generateContent with key in query, parses text + usageMetadata", async () => {
  const seen = mockFetch({
    candidates: [{ content: { parts: [{ text: "Hej" }] } }],
    usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2 },
  });
  const a = geminiAdapter({ apiKey: "g-key" });
  const res = await a.chat!(req);
  expect(seen[0]?.url).toContain(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=g-key",
  );
  expect(res.text).toBe("Hej");
  expect(res.usage.inputTokens).toBe(8);
  expect(res.usage.outputTokens).toBe(2);
  expect(res.usage.provider).toBe("gemini");
});

test("system turns map to systemInstruction; assistant maps to role 'model'", async () => {
  const seen = mockFetch({
    candidates: [{ content: { parts: [{ text: "ok" }] } }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
  });
  const a = geminiAdapter({ apiKey: "k" });
  await a.chat!({
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "u" },
      { role: "assistant", content: "a" },
    ],
    spec: req.spec,
  });
  const body = seen[0]?.body as {
    systemInstruction: { parts: { text: string }[] };
    contents: { role: string }[];
  };
  expect(body.systemInstruction.parts[0]?.text).toBe("sys");
  expect(body.contents.map((c) => c.role)).toEqual(["user", "model"]);
});

test("functionCall parts become normalized toolCalls", async () => {
  mockFetch({
    candidates: [
      { content: { parts: [{ functionCall: { name: "get_weather", args: { city: "Blokhus" } } }] } },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 },
  });
  const a = geminiAdapter({ apiKey: "k" });
  const res = await a.chat!({
    ...req,
    tools: [{ name: "get_weather", description: "w", parameters: { type: "object" } }],
  });
  expect(res.toolCalls?.[0]).toEqual({ id: "", name: "get_weather", arguments: { city: "Blokhus" } });
});

test("non-2xx throws with provider + status", async () => {
  mockFetch({ error: { message: "nope" } }, 403);
  const a = geminiAdapter({ apiKey: "k" });
  await expect(a.chat!(req)).rejects.toThrow(/gemini 403/);
});
