import type { TaskOptions } from "./model/config.interfaces.js";

export const taskConfig: TaskOptions = {
  categories: ["betano", "superbet"],
  maxPendingTasks: 1_000,
  executionTimeoutMs: 30_000,
  shutdownTimeoutMs: 20_000,
  maxTerminalTasks: 1_000,
};
