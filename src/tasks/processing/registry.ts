import type {
  TaskCommand,
  TaskEntry,
  TaskExecution,
  TaskExecutionResult,
  TaskStats,
  TaskSubmitResult,
} from "../model/task.interfaces.js";

export class TaskRegistry {
  private readonly entries = new Map<string, TaskEntry>();
  private sequence = 0;

  submit(
    command: TaskCommand,
    maxPendingTasks: number,
  ): { result: TaskSubmitResult; entry?: TaskEntry } {
    const current = this.entries.get(command.id);
    if (current !== undefined) {
      if (
        command.category !== current.category ||
        command.version <= current.version ||
        current.status === "completed" ||
        current.status === "failed" ||
        current.status === "cancelled" ||
        current.status === "uncertain"
      )
        return { result: "ignored", entry: current };
      current.version = command.version;
      current.payload = structuredClone(command.payload);
      return { result: "updated", entry: current };
    }
    if (this.pendingCount() >= maxPendingTasks) return { result: "full" };
    const entry: TaskEntry = {
      ...command,
      payload: structuredClone(command.payload),
      createdSequence: ++this.sequence,
      active: true,
      status: "pending",
      attemptId: null,
      runningVersion: null,
      cancellationRequested: false,
      queuedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
    };
    this.entries.set(entry.id, entry);
    return { result: "created", entry };
  }

  get(id: string): TaskEntry | undefined {
    return this.entries.get(id);
  }

  start(id: string, attemptId: string): TaskExecution | null {
    const entry = this.entries.get(id);
    if (entry === undefined || entry.status !== "pending" || !entry.active)
      return null;
    const startedAt = Date.now();
    entry.status = "running";
    entry.attemptId = attemptId;
    entry.runningVersion = entry.version;
    entry.startedAt = startedAt;
    return {
      id: entry.id,
      category: entry.category,
      version: entry.version,
      attemptId,
      payload: structuredClone(entry.payload),
      queuedAt: entry.queuedAt,
      startedAt,
    };
  }

  finish(task: TaskExecution, result: TaskExecutionResult): TaskEntry | null {
    const entry = this.entries.get(task.id);
    if (
      entry === undefined ||
      entry.status !== "running" ||
      entry.attemptId !== task.attemptId ||
      entry.runningVersion !== task.version
    )
      return null;
    entry.status = result.status;
    entry.active = false;
    entry.finishedAt = Date.now();
    if ("result" in result) entry.result = result.result;
    if (result.error !== undefined) entry.error = result.error;
    return entry;
  }

  withdraw(id: string): TaskEntry | null {
    const entry = this.entries.get(id);
    if (entry === undefined || !entry.active) return null;
    entry.active = false;
    if (entry.status === "pending") {
      entry.status = "cancelled";
      entry.finishedAt = Date.now();
    } else if (entry.status === "running") entry.cancellationRequested = true;
    return entry;
  }

  cancelPending(): TaskEntry[] {
    const cancelled: TaskEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== "pending") continue;
      entry.active = false;
      entry.status = "cancelled";
      entry.finishedAt = Date.now();
      cancelled.push(entry);
    }
    return cancelled;
  }

  markRunningUncertain(error: string): TaskEntry[] {
    const uncertain: TaskEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== "running") continue;
      entry.status = "uncertain";
      entry.active = false;
      entry.error = error;
      entry.finishedAt = Date.now();
      uncertain.push(entry);
    }
    return uncertain;
  }

  prune(maxTerminalTasks: number): void {
    const terminal = [...this.entries.values()]
      .filter((entry) => !["pending", "running"].includes(entry.status))
      .sort(
        (a, b) =>
          (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) ||
          a.createdSequence - b.createdSequence,
      );
    for (const entry of terminal.slice(
      0,
      Math.max(0, terminal.length - maxTerminalTasks),
    ))
      this.entries.delete(entry.id);
  }

  stats(blockedCategories: TaskStats["blockedCategories"]): TaskStats {
    const now = Date.now();
    const stats: TaskStats = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      uncertain: 0,
      oldestPendingMs: 0,
      longestRunningMs: 0,
      blockedCategories,
    };
    for (const entry of this.entries.values()) {
      stats[entry.status]++;
      if (entry.status === "pending")
        stats.oldestPendingMs = Math.max(
          stats.oldestPendingMs,
          now - entry.queuedAt,
        );
      if (entry.status === "running" && entry.startedAt !== null)
        stats.longestRunningMs = Math.max(
          stats.longestRunningMs,
          now - entry.startedAt,
        );
    }
    return stats;
  }

  private pendingCount(): number {
    let count = 0;
    for (const entry of this.entries.values())
      if (entry.status === "pending") count++;
    return count;
  }
}
