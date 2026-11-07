import type { TaskCategory } from "./task.interfaces.js";

export interface TaskOptions {
  categories: readonly TaskCategory[];
  maxPendingTasks: number;
  executionTimeoutMs: number;
  shutdownTimeoutMs: number;
  maxTerminalTasks: number;
}
