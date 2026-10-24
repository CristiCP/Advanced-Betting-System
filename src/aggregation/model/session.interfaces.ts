import type {
  AggregationBatchSink,
  AggregationProvider,
} from "./wire.interfaces.js";

export interface AggregationSessionHandlers {
  onError(provider: AggregationProvider, error: string): void;
}

// Receives operations only after the session validated them; clear() discards the provider entirely.
export interface AggregationProviderSink extends AggregationBatchSink {
  begin(now: number): void;
  commit(sentAt: number): void;
  clear(): void;
}

export interface AggregationSessionStats {
  connected: boolean;
  generation: number;
  sequence: number;
  events: number;
  lines: number;
  batches: number;
  operations: number;
  values: number;
  bytes: number;
  resyncs: number;
  // Window maxima since the previous periodic report.
  lagMs: number;
  maxLagMs: number;
  maxApplyMs: number;
}
