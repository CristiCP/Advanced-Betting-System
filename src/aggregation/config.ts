import type { AggregationOptions } from "./model/config.interfaces.js";

/**
 * @file Configures aggregation batching, handle limits, and reporting.
 */

export const aggregationConfig: AggregationOptions = {
  batchWindowMs: 25,
  maxEvents: 4_096,
  maxLines: 65_536,
  maxBatchBytes: 16 * 1024 * 1024,
  statsIntervalMs: 5_000,
};
