// F090 — ai.chat can be cut off. `timeoutMs` and `signal` become ONE AbortSignal that is
// handed to fetch, so the connection to the provider is actually closed — not merely
// stopped being waited for. Measured by mailworker 2026-11-12: one Mistral call held a
// weekly job open for 36+ minutes with 0 % CPU and nothing in the SDK could end it.

/** The call ran longer than the caller's `timeoutMs`; the request was aborted. */
export class AiTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number, what = "ai call") {
    super(`${what} timed out after ${timeoutMs} ms — the request was aborted`);
    this.name = "AiTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** The caller's own `signal` aborted the call. */
export class AiAbortError extends Error {
  constructor(what = "ai call") {
    super(`${what} was aborted by the caller's signal`);
    this.name = "AiAbortError";
  }
}

export interface CallAbort {
  signal?: AbortSignal;
  /** Turn a fetch/transport error into the named error when this abort caused it. */
  translate(e: unknown, what: string): unknown;
}

/** Combine the caller's signal and timeout into one signal for fetch. */
export function callAbort(callerSignal?: AbortSignal, timeoutMs?: number): CallAbort {
  const timeout = timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined;
  const parts = [callerSignal, timeout].filter((s): s is AbortSignal => !!s);
  const signal = parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : AbortSignal.any(parts);
  return {
    signal,
    translate(e, what) {
      if (!signal?.aborted) return e;
      if (timeout?.aborted && !callerSignal?.aborted) return new AiTimeoutError(timeoutMs!, what);
      return new AiAbortError(what);
    },
  };
}

/** A named abort is the caller's decision: never retry it on a fallback route. */
export function isCallerAbort(e: unknown): boolean {
  return e instanceof AiTimeoutError || e instanceof AiAbortError;
}
