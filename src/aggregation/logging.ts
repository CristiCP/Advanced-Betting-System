import type { AggregationHandlers } from "./model/controller.interfaces.js";

/**
 * @file Reports aggregation link statistics and errors.
 */

export const aggregationConsoleHandlers: AggregationHandlers = {
  onStatus(status) {
    if (status.kind === "stats") console.log("Aggregation:", status.stats);
  },
  onError(error, provider) {
    console.error("Aggregation:", { provider, error });
  },
};
