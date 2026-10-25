import type { AggregationOptions } from "./model/config.interfaces.js";

/**
 * @file Configures aggregation batching, matching tolerances, detection thresholds, and reporting.
 */

export const aggregationConfig: AggregationOptions = {
  batchWindowMs: 25,
  maxEvents: 4_096,
  maxLines: 65_536,
  maxBatchBytes: 16 * 1024 * 1024,
  enabledConditions: ["D", "P", "T"],
  statsIntervalMs: 5_000,
  startToleranceMs: 30 * 60_000,
  // Superbet reports whole minutes, so the tolerance covers granularity plus extrapolation.
  clockToleranceSeconds: 300,
  scoreSettleMs: 5_000,
  scoreMismatchMs: 60_000,
  maxLagMs: 2_000,
  minMarginBps: 200,
  suspiciousMarginBps: 1_000,
  reportStepBps: 10,
  sweepMs: 250,
  reportIntervalMs: 250,
  recordBufferLimit: 10_000,
  fallbackMode: "observe",
  recordPath: null,
  learningPath: null,
};
