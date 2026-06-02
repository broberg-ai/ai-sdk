import { expect, test } from "bun:test";
import { streamTransport, StreamHttpError } from "./stream.js";

/** Fake fetch that streams `chunks` as separate ReadableStream reads. */
function chunkedFetch(chunks: string[], status = 200): typeof fetch {
  return (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
    return new Response(status === 200 ? body : "upstream boom", { status });
  }) as unknown as typeof fetch;
}

const req = (fetchImpl: typeof fetch) => ({
  spec: { provider: "x", model: "m", transport: "http" as const },
  http: { url: "https://example.test/stream", headers: {}, body: {} },
  fetch: fetchImpl,
});

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of it) out.push(d);
  return out;
}

test("yields each SSE data payload, skips [DONE] and non-data lines", async () => {
  const fetchImpl = chunkedFetch([
    ": comment line\n",
    'data: {"a":1}\n\n',
    "event: ping\n",
    'data: {"b":2}\n\n',
    "data: [DONE]\n\n",
    'data: {"never":true}\n\n',
  ]);
  const out = await collect(streamTransport(req(fetchImpl)));
  expect(out).toEqual(['{"a":1}', '{"b":2}']);
});

test("reassembles a data line split across two reads", async () => {
  const fetchImpl = chunkedFetch(['data: {"hel', 'lo":true}\n\n', "data: [DONE]\n\n"]);
  const out = await collect(streamTransport(req(fetchImpl)));
  expect(out).toEqual(['{"hello":true}']);
});

test("throws StreamHttpError with status on a non-2xx connect", async () => {
  const fetchImpl = chunkedFetch([], 503);
  await expect(collect(streamTransport(req(fetchImpl)))).rejects.toBeInstanceOf(StreamHttpError);
  try {
    await collect(streamTransport(req(fetchImpl)));
  } catch (e) {
    expect((e as StreamHttpError).status).toBe(503);
  }
});
