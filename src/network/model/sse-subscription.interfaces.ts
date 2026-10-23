import type {
  StreamingNetworkTransport,
  TransportRequest,
  TransportStreamResponse,
} from "./transport.interfaces.js";

// Configure one independently reconnecting SSE response.
export interface SseSubscriptionOptions {
  transport: StreamingNetworkTransport;
  request: Omit<TransportRequest, "method" | "body">;
  headersTimeoutMs: number;
  retryDelayMs: number;
  onOpen(attempt: number, response: TransportStreamResponse): void;
  // Accept this chunk, then return false to pause subsequent delivery.
  onChunk(attempt: number, chunk: ArrayBuffer): boolean;
  onEnd(attempt: number, cancelled: boolean): void;
  onError(attempt: number, error: unknown): void;
  onStopped?(): void;
}

// Control a subscription without affecting other responses on its transport.
export interface SseSubscription {
  run(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
}
