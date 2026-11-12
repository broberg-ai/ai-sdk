// F090 — ai.chat timeoutMs / signal abort the fetch itself, throw a named error,
// write a failure row to the cost sink, and never fall back to another route.
import { expect, test } from "bun:test";
import { createAI } from "../client.js";
import { mistralAdapter } from "../providers/mistral.js";
import { AiAbortError, AiTimeoutError } from "./abort.js";

/** A fetch that never answers on its own — only an abort ends it. Records the signal. */
function hangingFetch(seen: { signals: (AbortSignal | undefined)[]; urls: string[] }) {
  return ((url: string, init?: RequestInit) => {
    seen.urls.push(url);
    const signal = init?.signal ?? undefined;
    seen.signals.push(signal);
    return new Promise<Response>((_, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("aborted", "AbortError")));
    });
  }) as unknown as typeof fetch;
}

function setup() {
  const seen = { signals: [] as (AbortSignal | undefined)[], urls: [] as string[] };
  const failures: { errorCode: string }[] = [];
  const sink = { record: async () => {}, recordFailure: async (f: { errorCode: string }) => void failures.push(f) };
  const ai = createAI({
    providers: { mistral: mistralAdapter({ apiKey: "k", fetch: hangingFetch(seen) }) },
    costSink: sink as never,
  });
  return { ai, seen, failures };
}

test("F090 timeoutMs aborts the fetch itself and throws AiTimeoutError", async () => {
  const { ai, seen } = setup();
  const t0 = Date.now();
  const err = await ai.chat({ prompt: "hi", tier: "cheap", timeoutMs: 50 }).then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AiTimeoutError);
  expect((err as AiTimeoutError).timeoutMs).toBe(50);
  expect(Date.now() - t0).toBeLessThan(2000);
  expect(seen.signals).toHaveLength(1);
  expect(seen.signals[0]?.aborted).toBe(true); // the connection was cut, not just abandoned
});

test("F090 a caller signal aborts the fetch and throws AiAbortError", async () => {
  const { ai, seen } = setup();
  const c = new AbortController();
  const p = ai.chat({ prompt: "hi", tier: "cheap", signal: c.signal });
  setTimeout(() => c.abort(), 20);
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AiAbortError);
  expect(seen.signals[0]?.aborted).toBe(true);
});

test("F090 an aborted call writes a failure row and is NOT retried on a fallback route", async () => {
  const { ai, seen, failures } = setup();
  await ai
    .chat({ prompt: "hi", tier: "cheap", timeoutMs: 30, fallback: [{ provider: "mistral", model: "mistral-large-2512", transport: "http" }] })
    .catch(() => {});
  expect(seen.urls).toHaveLength(1); // the fallback was not attempted
  expect(failures).toHaveLength(1);
  expect(failures[0]!.errorCode).toBe("timeout");
});

test("F090 chatStream honours timeoutMs and ends with an error event", async () => {
  const { ai, seen } = setup();
  const events: { type: string; message?: string }[] = [];
  for await (const ev of ai.chatStream({ prompt: "hi", tier: "cheap", timeoutMs: 30 })) events.push(ev as never);
  expect(seen.signals[0]?.aborted).toBe(true);
  expect(events.at(-1)?.type).toBe("error");
  expect(events.at(-1)?.message).toContain("timed out");
});

test("F090 without timeoutMs/signal nothing is attached to fetch", async () => {
  const seen = { signals: [] as (AbortSignal | undefined)[], urls: [] as string[] };
  const ok = ((url: string, init?: RequestInit) => {
    seen.signals.push(init?.signal ?? undefined);
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: "hej" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  const ai = createAI({ providers: { mistral: mistralAdapter({ apiKey: "k", fetch: ok }) }, costSink: null });
  const r = await ai.chat({ prompt: "hi", tier: "cheap" });
  expect(r.text).toBe("hej");
  expect(seen.signals[0]).toBeUndefined();
});
