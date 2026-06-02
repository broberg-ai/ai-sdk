// SSE streaming transport (F8.1). Like httpTransport but yields the parsed
// `data:` payloads from the response body instead of awaiting .json() — pure
// fetch + a ReadableStream reader, so it is Node 18+ and Bun safe. The adapter
// supplies the `stream:true` body and parses each yielded JSON string itself.
import type { TransportRequest } from "./types.js";

/** HTTP error from a streaming connect — carries `status` so the client's
 *  pre-stream fallback can tell an eligible 429/5xx from a hard 4xx. */
export class StreamHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "StreamHttpError";
    this.status = status;
  }
}

export interface StreamTransportRequest extends TransportRequest {
  /** Injectable fetch for tests. */
  fetch?: typeof fetch;
}

/**
 * Open an SSE stream and yield each event's `data:` payload as a raw string
 * (the JSON after `data: `), skipping the `[DONE]` terminator and non-data
 * lines. Throws StreamHttpError before the first yield on a non-2xx connect.
 */
export async function* streamTransport(req: StreamTransportRequest): AsyncIterable<string> {
  if (!req.http) throw new Error("streamTransport: req.http is required for http transport");
  const { url, method = "POST", headers, body } = req.http;
  const fetchImpl = req.fetch ?? fetch;
  const res = await fetchImpl(url, {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new StreamHttpError(`stream ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // OpenAI/Anthropic emit one `data: {json}\n\n` per event — parse per line.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue; // skip comments / event: / id:
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        if (data) yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
