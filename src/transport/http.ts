// HTTP transport: a thin fetch wrapper. Provider-agnostic — the adapter supplies
// the fully-built url/headers/body and parses the returned json itself.
import type { TransportRequest, HttpResponse } from "./types.js";

export async function httpTransport(req: TransportRequest): Promise<HttpResponse> {
  if (!req.http) {
    throw new Error("httpTransport: req.http is required for http transport");
  }
  const { url, method = "POST", headers, body } = req.http;
  const res = await fetch(url, {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, json };
}
