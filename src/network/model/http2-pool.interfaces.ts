import type { Http2Transport } from "../transports/http2/http2.js";

// Track one session while it accepts new work or drains existing streams.
export interface Http2PoolConnection {
  transport: Http2Transport;
  ready: boolean;
  draining: boolean;
  unsubscribe(): void;
}

// Queue an operation until a suitable session has free capacity.
export interface Http2PoolJob {
  kind: "request" | "stream";
  start(transport: Http2Transport): void;
  reject(error: unknown): void;
}
