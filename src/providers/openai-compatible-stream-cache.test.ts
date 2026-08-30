// F043 — the prompt cache never reached the streaming path.
//
// Reported independently by components (#24153) and sanne (#24154), both measured in
// the PUBLISHED 0.34.0 tarball: `prompt_cache_key` appears exactly once in dist,
// inside adapter.chat. Anyone calling chatStream got not less cache — none.
//
// It is worth stating why that is worse than it sounds: a streamed chat is the call
// shape where the SAME long system prompt is repeated turn after turn, so the one
// path that never cached is the one where caching pays most. And the type says
// `chatStream?(req: ChatRequest)` with the comment "Same request shape as chat",
// where ChatRequest carries promptCacheKey/promptCache — a silent omission behind a
// contract that says yes.
import { expect, test } from "bun:test";
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";

const spec = { provider: "mistral", model: "mistral-small-latest", transport: "http" as const };

/** Captures the request body, then returns a minimal well-formed SSE stream. */
function capturingFetch(sink: { body?: Record<string, unknown> }): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    sink.body = JSON.parse(String(init?.body));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    });
    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;
}

async function streamBody(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sink: { body?: Record<string, unknown> } = {};
  const adapter = makeOpenAICompatibleAdapter({
    name: "mistral",
    baseUrl: "https://mistral.test/v1",
    apiKey: "k",
    supportsPromptCacheKey: true,
    fetch: capturingFetch(sink),
  });
  for await (const _ of adapter.chatStream!({ spec, ...req } as never)) {
    /* drain */
  }
  return sink.body!;
}

const SYSTEM = "You are a careful assistant. ".repeat(40); // long enough to be worth caching

test("streaming sends prompt_cache_key derived automatically, like chat does", async () => {
  const body = await streamBody({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: "hej" },
    ],
  });
  expect(typeof body.prompt_cache_key).toBe("string");
  expect(String(body.prompt_cache_key).length).toBeGreaterThan(0);
});

test("an explicit promptCacheKey reaches the streamed body verbatim", async () => {
  const body = await streamBody({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: "hej" },
    ],
    promptCacheKey: "tenant-7:conv-12",
  });
  expect(body.prompt_cache_key).toBe("tenant-7:conv-12");
});

test("promptCache:false opts the streamed call out, exactly as on chat", async () => {
  const body = await streamBody({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: "hej" },
    ],
    promptCache: false,
  });
  expect(body.prompt_cache_key).toBeUndefined();
});

test("chat and chatStream build the SAME body apart from the streaming fields", async () => {
  // The drift guard. The two paths used to construct their bodies separately, so a
  // field added to one silently missed the other. This fails if they diverge again.
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: "hej" },
  ];
  const sink: { body?: Record<string, unknown> } = {};
  const chatAdapter = makeOpenAICompatibleAdapter({
    name: "mistral",
    baseUrl: "https://mistral.test/v1",
    apiKey: "k",
    supportsPromptCacheKey: true,
  });
  // chat() goes through the global-fetch http transport (config.fetch is
  // streaming-only in this adapter), so the non-streaming half is stubbed globally.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init?: RequestInit) => {
    sink.body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  try {
    await chatAdapter.chat!({ messages, spec, maxTokens: 100, temperature: 0.2 } as never);
  } finally {
    globalThis.fetch = realFetch;
  }
  const streamed = await streamBody({ messages, maxTokens: 100, temperature: 0.2 });

  const { stream, stream_options, ...streamedRest } = streamed;
  expect(stream).toBe(true);
  expect(stream_options).toEqual({ include_usage: true });
  expect(streamedRest).toEqual(sink.body!);
});
