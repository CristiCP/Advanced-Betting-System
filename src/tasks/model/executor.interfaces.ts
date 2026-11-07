import type {
  TaskCategory,
  TaskExecution,
  TaskExecutionResult,
  TaskPayload,
} from "./task.interfaces.js";

export interface TaskAdapter {
  execute(payload: TaskPayload, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

export type TaskAdapters = Readonly<Record<TaskCategory, TaskAdapter>>;

export interface TaskExecutorApi {
  execute(task: TaskExecution): Promise<TaskExecutionResult>;
  close(): Promise<void>;
}

export class UncertainTaskError extends Error {}
