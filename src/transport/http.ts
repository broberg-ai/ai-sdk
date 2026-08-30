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

/** Render a provider error body for an exception message, without ever throwing.
 *
 *  F043. `httpTransport` sets `json` to undefined when the response body is not JSON
 *  — an HTML 502 from a gateway, a proxy timeout page, an empty body. Four adapters
 *  then wrote `JSON.stringify(res.json).slice(0, 300)`, and JSON.stringify(undefined)
 *  returns undefined rather than a string, so the ERROR HANDLER crashed with
 *  "Cannot read properties of undefined (reading 'slice')" — replacing a useful
 *  "502 <gateway page>" with a TypeError that pointed nowhere near the real cause.
 *  Reported by cms via components (#24152) as a one-off they could not reproduce;
 *  it is not rare behaviour, it is a rare RESPONSE.
 *
 *  Same family as the two other faults measured that day: a missing value degrading
 *  into something that does not look like a missing value. Here it must look like one. */
export function errorBody(json: unknown, fallback = "(no body)"): string {
  if (json === undefined || json === null) return fallback;
  if (typeof json === "string") return json.slice(0, 300);
  try {
    return (JSON.stringify(json) ?? fallback).slice(0, 300);
  } catch {
    return fallback; // circular / non-serialisable — still must not throw
  }
}
