import { ReconnectingSseSubscription } from "./sse-subscription.js";
import type {
  SseSubscription,
  SseSubscriptionOptions,
} from "../model/sse-subscription.interfaces.js";
import type { SseSubscriptionRegistry } from "../model/subscription-registry.interfaces.js";

/**
 * @file Starts, supervises, and stops SSE subscriptions identified by match.
 */

export class SubscriptionRegistry implements SseSubscriptionRegistry {
  private readonly subscriptions = new Map<string, SseSubscription>();
  private closePromise: Promise<void> | null = null;
  private closing = false;

  // Include subscriptions that are still releasing their response resources.
  has(id: string): boolean {
    return this.subscriptions.has(id);
  }

  // Reject duplicate IDs and supervise execution without waiting for its end.
  start(id: string, options: SseSubscriptionOptions): void {
    if (this.closing) {
      throw new Error("SSE subscription registry is closing.");
    }
    if (id.trim().length === 0) {
      throw new Error("SSE subscription ID must not be empty.");
    }
    if (this.subscriptions.has(id)) {
      throw new Error(`SSE subscription already exists: ${id}`);
    }

    const subscription = new ReconnectingSseSubscription(options);
    this.subscriptions.set(id, subscription);
    void subscription
      .run()
      .catch((error: unknown) => {
        console.error(`SSE subscription failed: ${id}`, error);
      })
      .finally(() => {
        this.removeIfCurrent(id, subscription);
      });
  }

  pause(id: string): void {
    this.subscriptions.get(id)?.pause();
  }

  resume(id: string): void {
    this.subscriptions.get(id)?.resume();
  }

  // Release the ID only after the old response can no longer deliver bytes.
  async stop(id: string): Promise<void> {
    const subscription = this.subscriptions.get(id);
    if (subscription === undefined) {
      return;
    }
    try {
      await subscription.stop();
    } finally {
      this.removeIfCurrent(id, subscription);
    }
  }

  private removeIfCurrent(id: string, subscription: SseSubscription): void {
    if (this.subscriptions.get(id) === subscription) {
      this.subscriptions.delete(id);
    }
  }

  // Block new starts and stop every subscription concurrently.
  close(): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }
    this.closing = true;
    this.closePromise = this.stopAll();
    return this.closePromise;
  }

  private async stopAll(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.subscriptions.keys()].map((id) => this.stop(id)),
    );
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, "SSE subscription shutdown failed.");
    }
  }
}
