import type { MessagePort } from "node:worker_threads";
import type { AggregationOptions } from "./config.interfaces.js";
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

export type AggregationStats = Partial<
  Record<AggregationProvider, AggregationSessionStats>
>;

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
  | { type: "error"; error: string; provider?: AggregationProvider }
  | { type: "fatal"; error: string }
  | { type: "result"; commandId: number; value?: unknown; error?: string };
