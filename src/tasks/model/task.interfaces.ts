import type { AggregationSport } from "../../aggregation/model/tennis.interfaces.js";

export type TaskCategory = "betano" | "superbet";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "uncertain";

export interface BetanoBetTaskPayload {
  provider: "betano";
  opportunityId: number;
  eventId: number;
  selectionId: string;
  expectedPrice: number;
}

export interface SuperbetBetTaskPayload {
  provider: "superbet";
  opportunityId: number;
  sport: AggregationSport;
  eventId: number;
  marketId: number;
  selectionId: string;
  expectedPrice: number;
}

export type TaskPayload = BetanoBetTaskPayload | SuperbetBetTaskPayload;

export interface TaskCommand {
  id: string;
  category: TaskCategory;
  version: number;
  payload: TaskPayload;
}

export interface TaskEntry extends TaskCommand {
  createdSequence: number;
  active: boolean;
  status: TaskStatus;
  attemptId: string | null;
  runningVersion: number | null;
  cancellationRequested: boolean;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  result?: unknown;
  error?: string;
}

export interface TaskExecution {
  id: string;
  category: TaskCategory;
  version: number;
  attemptId: string;
  payload: TaskPayload;
  queuedAt: number;
  startedAt: number;
}

export interface TaskExecutionResult {
  status: "completed" | "failed" | "uncertain";
  result?: unknown;
  error?: string;
}

export type TaskSubmitResult = "created" | "updated" | "ignored" | "full";

export interface TaskStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  uncertain: number;
  oldestPendingMs: number;
  longestRunningMs: number;
  blockedCategories: TaskCategory[];
}
