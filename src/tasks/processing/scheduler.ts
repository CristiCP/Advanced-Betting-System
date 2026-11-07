import type { TaskCategory, TaskExecution } from "../model/task.interfaces.js";
import type { TaskRegistry } from "./registry.js";

interface RunningSlot {
  taskId: string;
  attemptId: string;
}

export class TaskScheduler {
  private readonly queues = new Map<TaskCategory, string[]>();
  private readonly running = new Map<TaskCategory, RunningSlot>();
  private readonly blocked = new Set<TaskCategory>();
  private nextAttempt = 1;

  constructor(categories: readonly TaskCategory[]) {
    for (const category of categories) this.queues.set(category, []);
  }

  enqueue(category: TaskCategory, id: string): void {
    this.queues.get(category)?.push(id);
  }

  reserve(
    category: TaskCategory,
    registry: TaskRegistry,
  ): TaskExecution | null {
    if (this.running.has(category) || this.blocked.has(category)) return null;
    const queue = this.queues.get(category);
    if (queue === undefined) return null;
    while (queue.length) {
      const id = queue.shift()!;
      const entry = registry.get(id);
      if (entry === undefined || entry.status !== "pending" || !entry.active)
        continue;
      const attemptId = `${category}:${this.nextAttempt++}`;
      this.running.set(category, { taskId: id, attemptId });
      const task = registry.start(id, attemptId);
      if (task !== null) return task;
      this.running.delete(category);
    }
    return null;
  }

  release(task: TaskExecution): boolean {
    const slot = this.running.get(task.category);
    if (slot?.taskId !== task.id || slot.attemptId !== task.attemptId)
      return false;
    this.running.delete(task.category);
    return true;
  }

  block(category: TaskCategory): void {
    this.blocked.add(category);
  }

  get blockedCategories(): TaskCategory[] {
    return [...this.blocked];
  }
}
