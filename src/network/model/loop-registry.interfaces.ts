import type { RequestLoopOptions } from "./request-loop.interfaces.js";

// Manage independently identified request loops within one network worker.
export interface RequestLoopRegistry {
  has(id: string): boolean;

  // Start a loop without waiting for its execution to finish.
  start(id: string, options: RequestLoopOptions): void;

  stop(id: string): Promise<void>;

  // Stop all loops and prevent new ones from starting.
  close(): Promise<void>;
}
