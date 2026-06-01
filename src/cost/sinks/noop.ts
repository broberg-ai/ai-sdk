import type { CostSink } from "../../types.js";

/** A sink that does nothing. The default when no costSink is configured. */
export const noopSink: CostSink = {
  record() {
    // intentionally empty
  },
};
