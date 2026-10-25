import type { MessagePort } from "node:worker_threads";
import type { AggregationSport } from "./tennis.interfaces.js";
import type { AggregationOptions } from "./config.interfaces.js";
import type {
  AggregationMatchedEvent,
  AggregationMatchingSummary,
} from "./matching.interfaces.js";
import type {
  AggregationOpportunityStats,
  AggregationReport,
} from "./opportunity.interfaces.js";
import type { AggregationSessionStats } from "./session.interfaces.js";
import type { AggregationProvider } from "./wire.interfaces.js";

export interface AggregationWorkerPort {
  sport?: AggregationSport;
  provider: AggregationProvider;
  port: MessagePort;
}

export interface AggregationWorkerData {
  options: AggregationOptions;
  ports: AggregationWorkerPort[];
  publishMatches?: boolean;
}

export interface AggregationStats {
  activeMatches: number;
  // Existing top-level fields describe football; sports contains each isolated engine.
  sports?: Partial<Record<AggregationSport, AggregationSportStats>>;
  sessions: Partial<Record<AggregationProvider, AggregationSessionStats>>;
  matching: AggregationMatchingSummary;
  opportunities: AggregationOpportunityStats;
  recorder: { written: number; queued: number; dropped: number };
  droppedReports: number;
}

export interface AggregationSportStats {
  // Confirmed live pairs with an eligible cross-provider line, before the margin threshold.
  activeMatches: number;
  sessions: Partial<Record<AggregationProvider, AggregationSessionStats>>;
  matching: AggregationMatchingSummary;
  opportunities: AggregationOpportunityStats;
  droppedReports: number;
}

export interface AggregationStatus {
  kind: "stats";
  stats: AggregationStats;
}

export interface AggregationQueryCommand {
  type: "query";
  commandId: number;
  operation: "stats";
}

export type AggregationWorkerCommand =
  AggregationQueryCommand | "start" | "stop";

export type AggregationWorkerMessage =
  | { type: "ready" }
  | { type: "matches"; matches: AggregationMatchedEvent[] }
  | { type: "status"; status: AggregationStatus }
  | { type: "reports"; reports: AggregationReport[] }
  | { type: "error"; error: string; provider?: AggregationProvider }
  | { type: "fatal"; error: string }
  | { type: "result"; commandId: number; value?: unknown; error?: string };
