// Transport-layer wire types. The transport decides HOW bytes travel (HTTP fetch
// vs local `claude -p` subprocess), never WHAT they contain — provider-specific
// request/response shaping is the adapter's job (F4).
import type { TierSpec } from "../types.js";

export interface TransportRequest {
  /** Resolved routing for this call (transport field selects the path). */
  spec: TierSpec;
  /** HTTP details — required when spec.transport === "http". The adapter has
   *  already built the provider-specific URL/headers/body. */
  http?: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  /** Subprocess details — required when spec.transport === "subprocess". */
  subprocess?: {
    prompt: string;
    systemPrompt?: string;
  };
}

/** HTTP transport result — raw, unparsed. The adapter reads text + token usage
 *  out of `json` (shapes differ per provider). */
export interface HttpResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

/** Subprocess transport result — already normalized from the `claude -p` JSON.
 *  costUsd is always 0 (Max plan is not a metered charge); subprocess flags it. */
export interface SubprocessResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: 0;
  subprocess: true;
}

export type TransportResponse = HttpResponse | SubprocessResponse;
