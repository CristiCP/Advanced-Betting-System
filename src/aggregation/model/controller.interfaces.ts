import type {
  AggregationMatchedEvent,
  AggregationObservedPair,
  AggregationPairReport,
} from "./matching.interfaces.js";
import type { AggregationOpportunityReport } from "./opportunity.interfaces.js";
import type { AggregationProvider } from "./wire.interfaces.js";
import type { AggregationStats, AggregationStatus } from "./worker.interfaces.js";

export interface AggregationHandlers {
  onMatches?(matches: AggregationMatchedEvent[]): void;
  onOpportunity?(report: AggregationOpportunityReport): void;
  onPair?(report: AggregationPairReport): void;
  onObserved?(report: AggregationObservedPair): void;
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
