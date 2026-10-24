import type { AggregationProvider } from "./wire.interfaces.js";
import type { AggregationStats, AggregationStatus } from "./worker.interfaces.js";

export interface AggregationHandlers {
  onStatus?(status: AggregationStatus): void;
  onError?(error: string, provider?: AggregationProvider): void;
}

export interface AggregationApi {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStats(): Promise<AggregationStats>;
}

export interface PendingAggregationQuery {
  resolve(value: unknown): void;
  reject(error: Error): void;
}
