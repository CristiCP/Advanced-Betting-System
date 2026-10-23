import type { SseSubscriptionOptions } from "./sse-subscription.interfaces.js";

// Manage independently identified SSE subscriptions within one network worker.
export interface SseSubscriptionRegistry {
  has(id: string): boolean;
  start(id: string, options: SseSubscriptionOptions): void;
  pause(id: string): void;
  resume(id: string): void;
  stop(id: string): Promise<void>;
  close(): Promise<void>;
}
