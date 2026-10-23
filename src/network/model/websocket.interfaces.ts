import type { BrowserTransport } from "../transports/browser-transport.js";
import type { NetworkStreamIdentity } from "./worker.interfaces.js";

// Configure a socket whose protocol is handled by its consumer.
export interface NetworkSocketOptions {
  id: string;
  origin: string;
  path: string;
  headers?: Record<string, string>;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
  retryDelayMs: number;
  maxInFlightBytes?: number;
  maxMessageBytes?: number;
}

export interface NetworkStartSocketCommand extends NetworkSocketOptions {
  type: "start-socket";
  commandId: number;
}

// Reject writes from a previous connection attempt after reconnection.
export interface NetworkSendSocketCommand extends NetworkStreamIdentity {
  type: "send-socket";
  commandId: number;
  attempt: number;
  data: string;
}

export interface NetworkStopSocketCommand {
  type: "stop-socket";
  commandId: number;
  id: string;
}

export interface ReconnectingSocketOptions extends NetworkSocketOptions {
  transport: BrowserTransport;
  onOpen(attempt: number): void;
  onChunk(attempt: number, chunk: ArrayBuffer): boolean;
  onEnd(attempt: number, cancelled: boolean): void;
  onError(attempt: number, error: unknown): void;
  onStopped(): void;
}
