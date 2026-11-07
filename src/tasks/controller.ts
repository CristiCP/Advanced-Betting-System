import { taskConfig } from "./config.js";
import type { TaskOptions } from "./model/config.interfaces.js";
import type {
  TaskApi,
  TaskHandlers,
} from "./model/controller.interfaces.js";
import type { TaskAdapters } from "./model/executor.interfaces.js";
import type {
  TaskCategory,
  TaskCommand,
  TaskExecution,
  TaskStats,
  TaskSubmitResult,
} from "./model/task.interfaces.js";
import { TaskExecutor } from "./processing/executor.js";
import { TaskRegistry } from "./processing/registry.js";
import { TaskScheduler } from "./processing/scheduler.js";

export class TaskController implements TaskApi {
  private readonly options: TaskOptions;
  private readonly registry = new TaskRegistry();
  private readonly scheduler: TaskScheduler;
  private readonly executor: TaskExecutor;
  private readonly running = new Set<Promise<void>>();
  private stopping: Promise<void> | null = null;

  constructor(
    adapters: TaskAdapters,
    options: Partial<TaskOptions> = {},
    private readonly handlers: TaskHandlers = {},
  ) {
    this.options = { ...taskConfig, ...options };
    this.validate();
    this.scheduler = new TaskScheduler(this.options.categories);
    this.executor = new TaskExecutor(this.options, adapters);
  }

  submit(command: TaskCommand): TaskSubmitResult {
    if (this.stopping !== null) return "ignored";
    const { result, entry } = this.registry.submit(
      command,
      this.options.maxPendingTasks,
    );
    if (result === "full") {
      this.handlers.onError?.(`Task queue is full; rejected ${command.id}.`);
      return result;
    }
    if (entry !== undefined && result !== "ignored")
      this.handlers.onState?.(entry);
    if (result === "created") this.scheduler.enqueue(command.category, command.id);
    this.pump(command.category);
    return result;
  }

  withdraw(id: string): boolean {
    const entry = this.registry.withdraw(id);
    if (entry === null) return false;
    this.handlers.onState?.(entry);
    this.pump(entry.category);
    return true;
  }

  getStats(): TaskStats {
    return this.registry.stats(this.scheduler.blockedCategories);
  }

  stop(): Promise<void> {
    this.stopping ??= this.shutdown();
    return this.stopping;
  }

  private pump(category: TaskCategory): void {
    if (this.stopping !== null) return;
    const task = this.scheduler.reserve(category, this.registry);
    if (task === null) return;
    const entry = this.registry.get(task.id);
    if (entry !== undefined) this.handlers.onState?.(entry);
    const operation = this.run(task);
    this.running.add(operation);
    void operation.finally(() => this.running.delete(operation));
  }

  private async run(task: TaskExecution): Promise<void> {
    const result = await this.executor.execute(task);
    const entry = this.registry.finish(task, result);
    if (entry === null || !this.scheduler.release(task)) return;
    this.handlers.onState?.(entry);
    this.registry.prune(this.options.maxTerminalTasks);
    if (result.status === "uncertain") {
      this.scheduler.block(task.category);
      this.handlers.onError?.(
        `Task ${task.id} is uncertain; category ${task.category} is blocked.`,
      );
      return;
    }
    this.pump(task.category);
  }

  private async shutdown(): Promise<void> {
    for (const entry of this.registry.cancelPending())
      this.handlers.onState?.(entry);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      Promise.allSettled([...this.running]).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(
          () => resolve(false),
          this.options.shutdownTimeoutMs,
        );
      }),
    ]);
    clearTimeout(timer);
    if (!completed)
      for (const entry of this.registry.markRunningUncertain(
        "Shutdown timed out while the external result was unknown.",
      ))
        this.handlers.onState?.(entry);
    await this.executor.close();
  }

  private validate(): void {
    if (
      this.options.categories.length === 0 ||
      new Set(this.options.categories).size !== this.options.categories.length
    )
      throw new Error("Task categories must be unique and non-empty.");
    for (const [key, value] of Object.entries({
      maxPendingTasks: this.options.maxPendingTasks,
      executionTimeoutMs: this.options.executionTimeoutMs,
      shutdownTimeoutMs: this.options.shutdownTimeoutMs,
      maxTerminalTasks: this.options.maxTerminalTasks,
    }))
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(`Invalid task option: ${key}`);
  }
}
