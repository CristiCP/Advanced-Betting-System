import type { MessagePort } from "node:worker_threads";
import type { AggregationOptions } from "./config.interfaces.js";
import type { AggregationMatchingSummary } from "./matching.interfaces.js";
import type {
  AggregationOpportunityStats,
  AggregationReport,
} from "./opportunity.interfaces.js";
import type { AggregationSessionStats } from "./session.interfaces.js";
import type { AggregationProvider } from "./wire.interfaces.js";

export interface AggregationWorkerPort {
  provider: AggregationProvider;
  port: MessagePort;
}

export interface AggregationWorkerData {
  options: AggregationOptions;
  ports: AggregationWorkerPort[];
}

export interface AggregationStats {
  sessions: Partial<Record<AggregationProvider, AggregationSessionStats>>;
  matching: AggregationMatchingSummary;
  opportunities: AggregationOpportunityStats;
  recorder: { written: number; queued: number; dropped: number };
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

export type AggregationWorkerCommand = AggregationQueryCommand | "start" | "stop";

export type AggregationWorkerMessage =
  | { type: "ready" }
  | { type: "status"; status: AggregationStatus }
  | { type: "reports"; reports: AggregationReport[] }
  | { type: "error"; error: string; provider?: AggregationProvider }
  | { type: "fatal"; error: string }
  | { type: "result"; commandId: number; value?: unknown; error?: string };
