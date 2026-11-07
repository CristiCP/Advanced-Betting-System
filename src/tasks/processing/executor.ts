import type { TaskOptions } from "../model/config.interfaces.js";
import type {
  TaskAdapters,
  TaskExecutorApi,
} from "../model/executor.interfaces.js";
import { UncertainTaskError } from "../model/executor.interfaces.js";
import type {
  TaskExecution,
  TaskExecutionResult,
} from "../model/task.interfaces.js";

export class TaskExecutor implements TaskExecutorApi {
  constructor(
    private readonly options: TaskOptions,
    private readonly adapters: TaskAdapters,
  ) {}

  async execute(task: TaskExecution): Promise<TaskExecutionResult> {
    const abort = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        const error = new Error("Task execution timed out.");
        abort.abort(error);
        reject(error);
      }, this.options.executionTimeoutMs);
    });
    try {
      const result = await Promise.race([
        this.adapters[task.category].execute(task.payload, abort.signal),
        timeout,
      ]);
      return { status: "completed", result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return timedOut || error instanceof UncertainTaskError
        ? { status: "uncertain", error: message }
        : { status: "failed", error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    await Promise.all(
      [...new Set(Object.values(this.adapters))].map((adapter) =>
        adapter.close(),
      ),
    );
  }
}
