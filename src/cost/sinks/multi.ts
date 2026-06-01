import type { CostSink, Usage } from "../../types.js";

/** Fan a Usage out to several sinks. Uses allSettled so one failing sink never
 *  prevents the others from recording (and never propagates to the caller). */
export function multiSink(sinks: CostSink[]): CostSink {
  return {
    async record(usage: Usage): Promise<void> {
      // async wrapper turns a synchronous throw in s.record into a rejected
      // promise, so allSettled isolates it (a sync throw would otherwise escape
      // the .map before allSettled ran).
      await Promise.allSettled(sinks.map(async (s) => s.record(usage)));
    },
  };
}
