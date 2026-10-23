import type {
  TransportOptions,
  TransportRequest,
  TransportResponse,
  TransportStreamResponse,
} from "./transport.interfaces.js";
import type { StreamDelivery } from "../streaming/stream-delivery.js";
import type { MessagePort } from "node:worker_threads";
import type {
  NetworkStartSocketCommand,
  NetworkSendSocketCommand,
  NetworkStopSocketCommand,
} from "./websocket.interfaces.js";

// Define the transport configurations received when the worker starts.
export interface NetworkWorkerData {
  transports: TransportOptions[];
}

export interface NetworkWorkerStartupData extends NetworkWorkerData {
  consumerPort?: MessagePort;
}

// Send one buffered request without creating a polling loop.
export interface NetworkRequestCommand {
  type: "request";
  commandId: number;
  origin: string;
  request: Omit<TransportRequest, "signal">;
}

export interface NetworkRequestResponseMessage {
  type: "request-response";
  commandId: number;
  response: TransportResponse;
}

// Define the readiness message sent to the parent.
export interface NetworkReadyMessage {
  type: "network-ready";
  threadId: number;
}

// Request an independent polling loop on an existing transport.
export interface NetworkStartLoopCommand {
  type: "start-loop";

  // Match this command with the worker's confirmation.
  commandId: number;

  id: string;
  origin: string;

  // Cancellation is managed inside the worker.
  request: Omit<TransportRequest, "signal">;

  retryDelayMs: number;

  // Target time between request starts after success; defaults to zero.
  intervalMs?: number;
}

// Request cancellation of one polling loop.
export interface NetworkStopLoopCommand {
  type: "stop-loop";
  commandId: number;
  id: string;
}

// Request an independently reconnecting SSE subscription.
export interface NetworkStartSubscriptionCommand {
  type: "start-subscription";
  commandId: number;
  id: string;
  origin: string;
  request: Omit<TransportRequest, "signal" | "method" | "body">;
  headersTimeoutMs: number;
  retryDelayMs: number;
  // Pause at this byte high-water mark; defaults to 256 KiB.
  // The final accepted chunk may cross the limit.
  maxInFlightBytes?: number;
}

// Stop one SSE subscription and await its response cleanup.
export interface NetworkStopSubscriptionCommand {
  type: "stop-subscription";
  commandId: number;
  id: string;
}

// Release one delivered chunk without creating another confirmation message.
export interface NetworkStreamAckCommand {
  type: "ack-stream";
  id: string;
  generation: number;
  sequence: number;
}

// Identify the lifecycle commands that receive a success or error response.
export type NetworkConfirmedCommand =
  | NetworkRequestCommand
  | NetworkStartSocketCommand
  | NetworkSendSocketCommand
  | NetworkStopSocketCommand
  | NetworkStartLoopCommand
  | NetworkStopLoopCommand
  | NetworkStartSubscriptionCommand
  | NetworkStopSubscriptionCommand;

// Define the commands accepted by the network worker.
export type NetworkWorkerCommand =
  NetworkConfirmedCommand | NetworkStreamAckCommand | "stop";

// Confirm that a command completed successfully.
export interface NetworkCommandSuccessMessage {
  type: "command-success";
  commandId: number;
}

// Report a command failure.
export interface NetworkCommandErrorMessage {
  type: "command-error";
  commandId: number;
  error: string;
}

// Deliver a complete, unparsed HTTP response from one loop.
export interface NetworkLoopResponseMessage {
  type: "loop-response";
  id: string;
  response: TransportResponse;
}

// Report a request failure while its loop remains eligible to retry.
export interface NetworkLoopErrorMessage {
  type: "loop-error";
  id: string;
  error: string;
}

// Identify a subscription instance independently of later reuse of its ID.
export interface NetworkStreamIdentity {
  id: string;
  generation: number;
}

// Publish headers before delivering raw bytes from this connection attempt.
export interface NetworkStreamOpenMessage extends NetworkStreamIdentity {
  type: "stream-open";
  attempt: number;
  response: TransportStreamResponse;
}

// Transfer an arbitrary raw segment, which may contain partial SSE events.
export interface NetworkStreamChunkMessage extends NetworkStreamIdentity {
  type: "stream-chunk";
  attempt: number;
  sequence: number;
  chunk: ArrayBuffer;
}

// Mark the end of an opened response before any later reconnect opens.
export interface NetworkStreamEndMessage extends NetworkStreamIdentity {
  type: "stream-end";
  attempt: number;
  cancelled: boolean;
}

// Report an opening or response failure while the subscription may retry.
export interface NetworkStreamErrorMessage extends NetworkStreamIdentity {
  type: "stream-error";
  attempt: number;
  error: string;
}

// Mark permanent termination, including an HTTP 204 response.
export interface NetworkStreamStoppedMessage extends NetworkStreamIdentity {
  type: "stream-stopped";
}

// Group ordered SSE delivery messages sent to the consumer.
export type NetworkStreamMessage =
  | NetworkStreamOpenMessage
  | NetworkStreamChunkMessage
  | NetworkStreamEndMessage
  | NetworkStreamErrorMessage
  | NetworkStreamStoppedMessage;

// Keep byte acknowledgements tied to the currently registered instance.
export interface NetworkSubscriptionDelivery {
  generation: number;
  delivery: StreamDelivery;
}

// Define the messages sent by the network worker to its parent.
export type NetworkWorkerMessage =
  | NetworkRequestResponseMessage
  | NetworkReadyMessage
  | NetworkCommandSuccessMessage
  | NetworkCommandErrorMessage
  | NetworkLoopResponseMessage
  | NetworkLoopErrorMessage
  | NetworkStreamMessage;
