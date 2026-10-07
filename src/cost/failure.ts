// F071.1 — a failed AI call, as a record the cost sink can report.
//
// Measured 2026-10-07: runCapability reported only SUCCESSFUL calls, and the upmetrics
// sink hardcoded status "success". A provider that revoked our key, pulled a model or
// went down overnight produced no row at all — the one event Model Watch exists to see
// was the one event we never sent.
import type { Capability, Tier } from "../types.js";

export type FailureKind = "auth" | "not_found" | "rate_limit" | "server" | "timeout" | "network" | "other";

export interface CallFailure {
  provider: string;
  /** The model we ASKED for (the route that failed). */
  model: string;
  transport: string;
  capability: Capability;
  tier?: Tier;
  purpose?: string;
  labels?: Record<string, string>;
  latencyMs: number;
  ts: string;
  /** HTTP status as a string ("401", "503"), or "timeout" | "network" | "unknown". */
  errorCode: string;
  errorKind: FailureKind;
}

/** Read the HTTP status off an adapter error. Adapters throw `new Error("<provider> <status>: …")`
 *  — e.g. "openai 401: …", "vertex animate 404: {…" — so the status is the first 4xx/5xx
 *  number standing alone on the first line. A numeric `status` field wins when present. */
export function classifyFailure(err: unknown): { errorCode: string; errorKind: FailureKind } {
  const e = err as { name?: string; message?: string; status?: unknown; cause?: { code?: string } };
  const name = e?.name ?? "";
  const message = String(e?.message ?? "");
  if (name === "AbortError" || name === "TimeoutError" || /timed? ?out/i.test(message.split("\n")[0] ?? "")) {
    return { errorCode: "timeout", errorKind: "timeout" };
  }
  let status: number | undefined = typeof e?.status === "number" ? e.status : undefined;
  if (status === undefined) {
    const m = /(?:^|\s)([45]\d{2})(?=[:\s]|$)/.exec(message.split("\n")[0] ?? "");
    if (m) status = Number(m[1]);
  }
  if (status !== undefined) {
    const kind: FailureKind =
      status === 401 || status === 403 ? "auth"
      : status === 404 ? "not_found"
      : status === 429 ? "rate_limit"
      : status >= 500 ? "server"
      : "other";
    return { errorCode: String(status), errorKind: kind };
  }
  if (name === "TypeError" && /fetch failed|network|ECONN|ENOTFOUND/i.test(message + (e?.cause?.code ?? ""))) {
    return { errorCode: "network", errorKind: "network" };
  }
  return { errorCode: "unknown", errorKind: "other" };
}
