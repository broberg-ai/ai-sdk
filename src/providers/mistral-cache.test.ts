// F039.1 — prompt caching on Mistral. We were dropping the parameter that makes it
// work: measured 2026-08-27, an 8,810-token prefix reported cached_tokens 0 twice
// WITHOUT prompt_cache_key (and 0 at every size up to 57k), then 8,784 WITH it.
import { describe, expect, test } from "bun:test";
import { makeOpenAICompatibleAdapter } from "./openai-compatible.js";
import { computeCost } from "../cost/usage.js";
import { PRICING } from "../cost/pricing.js";
import type { ChatRequest, ChatResult } from "../types.js";

const spec = { provider: "mistral", model: "mistral-large-latest", transport: "http" as const };
const baseReq: ChatRequest = { messages: [{ role: "user", content: "hi" }], spec };

/** Run chat() against a mocked global fetch, capturing the request body. */
async function chatCapturing(
  json: unknown,
  req: ChatRequest = baseReq,
): Promise<{ sent: Record<string, unknown>; res: ChatResult }> {
  const real = globalThis.fetch;
  let sent: Record<string, unknown> = {};
  globalThis.fetch = (async (_u: string, init: { body?: string }) => {
    sent = JSON.parse(init.body ?? "{}");
    return new Response(JSON.stringify(json), { status: 200 });
  }) as unknown as typeof fetch;
  try {
    const adapter = makeOpenAICompatibleAdapter({ name: "mistral", baseUrl: "https://x/v1", apiKey: "k", supportsPromptCacheKey: true });
    // Await FIRST: object-literal properties evaluate in order, so `sent` read
    // before the await would capture the empty object every time — a test that
    // passes on an absent field by accident.
    const res = await adapter.chat!(req);
    return { sent, res };
  } finally {
    globalThis.fetch = real;
  }
}

const okBody = (usage: Record<string, unknown>) => ({
  choices: [{ message: { content: "ok" } }],
  usage,
});

describe("the request carries the cache key — or nothing", () => {
  test("promptCacheKey is sent as prompt_cache_key", async () => {
    const { sent } = await chatCapturing(okBody({ prompt_tokens: 10, completion_tokens: 2 }), {
      ...baseReq,
      promptCacheKey: "conversation-42",
    });
    expect(sent.prompt_cache_key).toBe("conversation-42");
  });

  test("no key and no system prompt → the field is ABSENT, not empty-string", async () => {
    // Asserted on the captured body, not on the absence of an error: an empty
    // string would be a different (and wrong) cache identity, not "no key".
    const { sent } = await chatCapturing(okBody({ prompt_tokens: 10, completion_tokens: 2 }));
    expect("prompt_cache_key" in sent).toBe(false);
  });
});

describe("cached_tokens is read back — and not double-billed", () => {
  test("cached_tokens lands on usage.cacheReadTokens", async () => {
    const { res } = await chatCapturing(
      okBody({ prompt_tokens: 8810, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 8784 } }),
    );
    expect(res.usage.cacheReadTokens).toBe(8784);
  });

  test("inputTokens EXCLUDES the cached ones, because computeCost adds them on top", async () => {
    // prompt_tokens (8810) includes the cached 8784. Billing the raw figure would
    // charge the cached prefix twice — once at full rate, once at the cache rate.
    const { res } = await chatCapturing(
      okBody({ prompt_tokens: 8810, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 8784 } }),
    );
    expect(res.usage.inputTokens).toBe(26);
    expect(res.usage.inputTokens + (res.usage.cacheReadTokens ?? 0)).toBe(8810);
  });

  test("an ABSENT cached_tokens does not eat into inputTokens", async () => {
    // KNOWN AMBIGUITY, documented rather than hidden: freshUsage defaults
    // cacheReadTokens to 0 for every provider, so 0 means both "no cache hit" and
    // "this provider never reports it". Billing is correct either way (nothing is
    // charged at the cache rate), but a caller cannot ask "did caching happen?"
    // from this field alone. Left as-is because narrowing the type would change a
    // field every adapter writes, for a distinction only Mistral currently makes.
    const { res } = await chatCapturing(okBody({ prompt_tokens: 8810, completion_tokens: 4 }));
    expect(res.usage.cacheReadTokens).toBe(0);
    expect(res.usage.inputTokens).toBe(8810); // the whole prompt, nothing subtracted
  });
});

describe("cached tokens bill at 10% of the input rate", () => {
  test("every mistral row carries cacheReadPer1M at exactly 10% of its input rate", () => {
    const rows = Object.entries(PRICING).filter(([k]) => k.startsWith("mistral:"));
    expect(rows.length).toBeGreaterThan(10);
    for (const [k, p] of rows) {
      if (p.inputPer1M === 0) continue; // per-page/per-call models
      expect({ k, rate: p.cacheReadPer1M }).toEqual({ k, rate: Number((p.inputPer1M * 0.1).toFixed(6)) });
    }
  });

  test("the discount is real, computed not read from the table", () => {
    // mistral-large: input $0.5/1M, cache-read $0.05/1M, output $1.5/1M.
    const uncached = computeCost("mistral", "mistral-large-latest", 8810, 4, 0);
    const cached = computeCost("mistral", "mistral-large-latest", 26, 4, 8784);
    expect(uncached).toBeCloseTo(8810 * 0.5e-6 + 4 * 1.5e-6, 12);
    expect(cached).toBeCloseTo(26 * 0.5e-6 + 8784 * 0.05e-6 + 4 * 1.5e-6, 12);
    expect(cached).toBeLessThan(uncached);
    // ~90% off the prompt half.
    expect(cached / uncached).toBeLessThan(0.15);
  });
});


// F039.2 — caching is ON BY DEFAULT. Opt-in only saves money for callers who read
// a changelog; this repo already learned that once, when ~91% of Mistral spend was
// invisible because per-repo cost-sink wiring drifted (F034).
const bigSystem = "Du er en assistent med en lang fast instruktion. ".repeat(20);

describe("on by default", () => {
  test("a long system prompt gets an auto key with NO caller involvement", async () => {
    const { sent } = await chatCapturing(okBody({ prompt_tokens: 500, completion_tokens: 2 }), {
      ...baseReq,
      messages: [{ role: "system", content: bigSystem }, { role: "user", content: "hi" }],
    });
    expect(typeof sent.prompt_cache_key).toBe("string");
    expect(sent.prompt_cache_key as string).toStartWith("ai-sdk-auto-");
  });

  test("the auto key is CONTENT-derived: same prompt → same key, different → different", async () => {
    // This is the security property. A collision must imply identical content, so
    // that sharing a cached prefix cannot reveal anything the other caller did not
    // already send. An id-derived key ("conversation 42") would collide across
    // tenants whose content DIFFERS — the trap components flagged.
    const mk = async (sys: string) =>
      (await chatCapturing(okBody({ prompt_tokens: 500, completion_tokens: 2 }), {
        ...baseReq,
        messages: [{ role: "system", content: sys }, { role: "user", content: "hi" }],
      })).sent.prompt_cache_key;
    expect(await mk(bigSystem)).toBe((await mk(bigSystem)) as string);
    expect(await mk(bigSystem)).not.toBe((await mk(bigSystem + "x")) as string);
  });

  test("the user turn does NOT change the key — only the cacheable prefix does", async () => {
    const mk = async (user: string) =>
      (await chatCapturing(okBody({ prompt_tokens: 500, completion_tokens: 2 }), {
        ...baseReq,
        messages: [{ role: "system", content: bigSystem }, { role: "user", content: user }],
      })).sent.prompt_cache_key;
    expect(await mk("spørgsmål et")).toBe((await mk("et helt andet spørgsmål")) as string);
  });

  test("promptCache:false opts out — visibly, in the API", async () => {
    const { sent } = await chatCapturing(okBody({ prompt_tokens: 500, completion_tokens: 2 }), {
      ...baseReq,
      promptCache: false,
      messages: [{ role: "system", content: bigSystem }, { role: "user", content: "hi" }],
    });
    expect("prompt_cache_key" in sent).toBe(false);
  });

  test("an explicit key always wins over the auto one", async () => {
    const { sent } = await chatCapturing(okBody({ prompt_tokens: 500, completion_tokens: 2 }), {
      ...baseReq,
      promptCacheKey: "tenant-7:conversation-42",
      messages: [{ role: "system", content: bigSystem }, { role: "user", content: "hi" }],
    });
    expect(sent.prompt_cache_key).toBe("tenant-7:conversation-42");
  });

  test("a SHORT system prompt gets no key — nothing to gain, and a key is not free of thought", async () => {
    const { sent } = await chatCapturing(okBody({ prompt_tokens: 20, completion_tokens: 2 }), {
      ...baseReq,
      messages: [{ role: "system", content: "kort" }, { role: "user", content: "hi" }],
    });
    expect("prompt_cache_key" in sent).toBe(false);
  });
});

describe("the key is only sent where the provider understands it", () => {
  test("a provider without supportsPromptCacheKey never receives the field", async () => {
    // An unknown field is ignored by some OpenAI-compatible servers and rejected
    // with a 400 by others. Sending it everywhere would trade a saving for an outage.
    const real = globalThis.fetch;
    let sent: Record<string, unknown> = {};
    globalThis.fetch = (async (_u: string, init: { body?: string }) => {
      sent = JSON.parse(init.body ?? "{}");
      return new Response(JSON.stringify(okBody({ prompt_tokens: 500, completion_tokens: 2 })), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const adapter = makeOpenAICompatibleAdapter({ name: "openrouter", baseUrl: "https://x/v1", apiKey: "k" });
      await adapter.chat!({
        ...baseReq,
        promptCacheKey: "explicit",
        messages: [{ role: "system", content: bigSystem }, { role: "user", content: "hi" }],
      });
    } finally {
      globalThis.fetch = real;
    }
    expect("prompt_cache_key" in sent).toBe(false);
  });
});
