// Usage construction + cost computation. Real adapters (F4) build their Usage via
// freshUsage() and fill costUsd from computeCost(). The pricing table lives in
// ./pricing.ts (F3.6); until a model is priced, computeCost returns 0 so calls
// still complete (cost just shows $0 rather than throwing).
import { getPrice } from "./pricing.js";
import { regionOfProvider, type Region } from "./region.js";
import type { Usage, Transport, Capability } from "../types.js";

/**
 * Cost in USD for a call. cache-read/creation tokens are priced separately when
 * the pricing entry defines rates for them; otherwise they fall back to the
 * input rate (read) / are ignored (creation). Unknown model → 0.
 */
export function computeCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
): number {
  const price = getPrice(provider, model);
  if (!price) return 0;
  const perToken = (per1M: number) => per1M / 1_000_000;
  const inRate = perToken(price.inputPer1M);
  const outRate = perToken(price.outputPer1M);
  const cacheReadRate =
    price.cacheReadPer1M !== undefined ? perToken(price.cacheReadPer1M) : inRate;
  const cacheWriteRate =
    price.cacheWritePer1M !== undefined ? perToken(price.cacheWritePer1M) : inRate;
  return (
    inputTokens * inRate +
    outputTokens * outRate +
    cacheReadTokens * cacheReadRate +
    cacheCreationTokens * cacheWriteRate
  );
}

/** Build a Usage with cost computed from the pricing table. Adapters call this
 *  after a successful provider call; latencyMs/ts/capability are stamped by the
 *  client (call-context owner), so they default to 0/""/the passed capability. */
export function freshUsage(args: {
  provider: string;
  model: string;
  transport: Transport;
  capability: Capability;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Data residency of the endpoint this call ACTUALLY used (F042). Pass it from any
   *  adapter whose region a consumer can change — vertex, azure, bfl. Omitting it
   *  falls back to the fixed provider table, which does not list those three, so a
   *  forgetful adapter degrades to "unknown" rather than to a false "eu". */
  region?: Region;
  subprocess?: boolean;
}): Usage {
  const cacheReadTokens = args.cacheReadTokens ?? 0;
  const cacheCreationTokens = args.cacheCreationTokens ?? 0;
  // Subprocess (Max plan) is never a metered charge to us — cost is always 0.
  const costUsd = args.subprocess
    ? 0
    : computeCost(
        args.provider,
        args.model,
        args.inputTokens,
        args.outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
      );
  const usage: Usage = {
    provider: args.provider,
    model: args.model,
    region: args.region ?? regionOfProvider(args.provider),
    transport: args.transport,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    costUsd,
    // F050 — say HOW we got the number. A $0 because the model is not in the price
    // table and a $0 because the call was genuinely free were the same value, and the
    // free case is much rarer than the unknown one. Adapters that bill a non-token
    // unit overwrite this with "estimated"/"reported" right after.
    costBasis: args.subprocess
      ? "computed" // Max-plan subprocess: 0 is the real, known cost, not a gap.
      : getPrice(args.provider, args.model)
        ? "computed"
        : "unpriced",
    latencyMs: 0,
    capability: args.capability,
    ts: "",
  };
  if (args.subprocess) usage.subprocess = true;
  return usage;
}
