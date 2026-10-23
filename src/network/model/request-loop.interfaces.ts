import type {
  NetworkTransport,
  TransportRequest,
  TransportResponse,
} from "./transport.interfaces.js";

// Configure a continuous sequence of requests for one endpoint.
export interface RequestLoopOptions {
  transport: NetworkTransport;
  request: TransportRequest;
  retryDelayMs: number;

  // Target time between request starts after success; defaults to zero.
  intervalMs?: number;

  // Hand off raw data synchronously, without processing the payload.
  onResponse(response: TransportResponse): void;

  onError(error: unknown): void;
}

// Define the execution and shutdown of an independent request loop.
export interface RequestLoop {
  // Resolve when the loop finishes, rather than when it starts.
  run(): Promise<void>;

  stop(): Promise<void>;
}
