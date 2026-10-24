import type { AggregationOutboxOptions } from "./wire.interfaces.js";

// Name-only pairs are never used by the detector; "observe" reports them for review.
export type AggregationFallbackMode = "off" | "observe";

export interface AggregationOptions extends AggregationOutboxOptions {
  statsIntervalMs: number;
  startToleranceMs: number;
  clockToleranceSeconds: number;
  scoreSettleMs: number;
  scoreMismatchMs: number;
  maxLagMs: number;
  // Margins are integer basis points: 50 = 0.5%.
  minMarginBps: number;
  suspiciousMarginBps: number;
  reportStepBps: number;
  sweepMs: number;
  reportIntervalMs: number;
  recordBufferLimit: number;
  fallbackMode: AggregationFallbackMode;
  // JSONL opportunity log and learned name/competition tables; null disables each file.
  recordPath: string | null;
  learningPath: string | null;
}
