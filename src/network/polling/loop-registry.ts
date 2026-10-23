import { ContinuousRequestLoop } from "./request-loop.js";
import type { RequestLoopRegistry } from "../model/loop-registry.interfaces.js";
import type {
  RequestLoop,
  RequestLoopOptions,
} from "../model/request-loop.interfaces.js";

/**
 * @file Starts, supervises, and stops independently identified request loops.
 */

export class LoopRegistry implements RequestLoopRegistry {
  private readonly loops = new Map<string, RequestLoop>();
  private closePromise: Promise<void> | null = null;
  private closing = false;

  // Check whether an ID is registered, including while its loop is stopping.
  has(id: string): boolean {
    return this.loops.has(id);
  }

  // Start one loop without waiting for its execution to finish.
  start(id: string, options: RequestLoopOptions): void {
    if (this.closing) {
      throw new Error("Request loop registry is closing.");
    }

    if (id.trim().length === 0) {
      throw new Error("Request loop ID must not be empty.");
    }

    if (this.loops.has(id)) {
      throw new Error(`Request loop already exists: ${id}`);
    }

    const loop = new ContinuousRequestLoop(options);
    this.loops.set(id, loop);

    // Report terminal failures and remove the finished loop.
    void loop
      .run()
      .catch((error: unknown) => {
        console.error(`Request loop failed: ${id}`, error);
      })
      .finally(() => {
        this.removeIfCurrent(id, loop);
      });
  }

  // Stop the selected loop and release its ID after termination.
  async stop(id: string): Promise<void> {
    const loop = this.loops.get(id);

    if (loop === undefined) {
      return;
    }

    try {
      await loop.stop();
    } finally {
      this.removeIfCurrent(id, loop);
    }
  }

  // Preserve a replacement loop if the same ID has already been reused.
  private removeIfCurrent(id: string, loop: RequestLoop): void {
    if (this.loops.get(id) === loop) {
      this.loops.delete(id);
    }
  }

  // Block new starts and reuse the same shutdown promise.
  close(): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }

    this.closing = true;
    this.closePromise = this.stopAll();

    return this.closePromise;
  }

  // Attempt every shutdown before reporting any failures.
  private async stopAll(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.loops.keys()].map((id) => this.stop(id)),
    );

    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );

    if (errors.length > 0) {
      throw new AggregateError(errors, "Request loop shutdown failed.");
    }
  }
}
