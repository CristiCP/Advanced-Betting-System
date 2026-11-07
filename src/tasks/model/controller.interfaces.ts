import type {
  TaskCommand,
  TaskEntry,
  TaskStats,
  TaskSubmitResult,
} from "./task.interfaces.js";

export interface TaskHandlers {
  onState?(task: Readonly<TaskEntry>): void;
  onError?(error: string): void;
}

export interface TaskApi {
  submit(command: TaskCommand): TaskSubmitResult;
  withdraw(id: string): boolean;
  getStats(): TaskStats;
  stop(): Promise<void>;
}
