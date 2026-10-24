import type { AggregationOutboxOptions } from "./wire.interfaces.js";

export interface AggregationOptions extends AggregationOutboxOptions {
  statsIntervalMs: number;
}
