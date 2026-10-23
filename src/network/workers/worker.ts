import {
  isMainThread,
  parentPort,
  threadId,
  workerData,
} from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";
import { HttpTransport } from "../transports/transport.js";
import { BrowserTransport } from "../transports/browser-transport.js";
import { ReconnectingSocket } from "../streaming/websocket.js";
import { SubscriptionRegistry } from "../streaming/subscription-registry.js";
import { StreamDelivery } from "../streaming/stream-delivery.js";
import type {
  NetworkTransport,
  StreamingNetworkTransport,
} from "../model/transport.interfaces.js";
import type {
  NetworkCommandErrorMessage,
  NetworkCommandSuccessMessage,
  NetworkLoopErrorMessage,
  NetworkLoopResponseMessage,
  NetworkReadyMessage,
  NetworkStreamChunkMessage,
  NetworkStreamEndMessage,
  NetworkStreamErrorMessage,
  NetworkStreamOpenMessage,
  NetworkStreamStoppedMessage,
  NetworkSubscriptionDelivery,
  NetworkWorkerCommand,
  NetworkWorkerStartupData,
  NetworkRequestResponseMessage,
} from "../model/worker.interfaces.js";
import { LoopRegistry } from "../polling/loop-registry.js";

/**
 * @file Owns polling loops, SSE subscriptions, and shared network transports.
 */

// Ensure this file runs inside a worker.
if (isMainThread || parentPort === null) {
  throw new Error("This file must run inside a worker.");
}

// Store the parent channel and the configuration received at startup.
const port = parentPort;
const data: NetworkWorkerStartupData = workerData;
const transports = new Map<string, NetworkTransport>();
const sockets = new Map<string, ReconnectingSocket>();
const loops = new LoopRegistry();
const subscriptions = new SubscriptionRegistry();
const deliveries = new Map<string, NetworkSubscriptionDelivery>();
let nextGeneration = 1;
let ready = false;
let stopping = false;
let shutdownPromise: Promise<void> | null = null;

// Share one shutdown operation and stop accepting new startup work.
function shutdown(): Promise<void> {
  if (shutdownPromise !== null) {
    return shutdownPromise;
  }

  stopping = true;
  ready = false;
  shutdownPromise = closeResources();
  return shutdownPromise;
}

// Stop loops and subscriptions before closing their shared transports.
async function closeResources(): Promise<void> {
  const errors: unknown[] = [];

  try {
    const stopped = await Promise.allSettled([
      loops.close(),
      subscriptions.close(),
      ...[...sockets.values()].map((socket) => socket.stop()),
    ]);
    for (const result of stopped) {
      if (result.status === "rejected") {
        errors.push(result.reason);
      }
    }
    deliveries.clear();

    // Attempt to close every transport independently.
    const results = await Promise.allSettled(
      [...transports.values()].map((transport) => transport.close()),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        errors.push(result.reason);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "Network resource shutdown failed.");
    }
  } finally {
    data.consumerPort?.close();
    port.close();
  }
}

// Convert failures into text that can cross the worker boundary.
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Execute one command without blocking other message handlers.
async function handleCommand(
  command: NetworkWorkerCommand,
  reply: MessagePort = port,
): Promise<void> {
  if (command === "stop") {
    await shutdown();
    return;
  }

  // Old or duplicate acknowledgements cannot release another instance's bytes.
  if (command.type === "ack-stream") {
    const current = deliveries.get(command.id);
    if (
      !stopping &&
      current?.generation === command.generation &&
      current.delivery.acknowledge(command.sequence)
    ) {
      subscriptions.resume(command.id);
      sockets.get(command.id)?.resume();
    }
    return;
  }

  try {
    if (!ready || stopping) {
      throw new Error("Network worker is not ready to accept commands.");
    }

    switch (command.type) {
      case "request": {
        const transport = transports.get(new URL(command.origin).origin);
        if (transport === undefined) throw new Error("Unknown network origin.");
        const response = await transport.request(command.request);
        reply.postMessage(
          {
            type: "request-response",
            commandId: command.commandId,
            response,
          } satisfies NetworkRequestResponseMessage,
          [response.body],
        );
        return;
      }

      case "start-socket": {
        if (!command.id.trim() || deliveries.has(command.id))
          throw new Error("Stream ID is empty or already registered.");
        const transport = transports.get(new URL(command.origin).origin);
        if (!(transport instanceof BrowserTransport))
          throw new Error("WebSockets require a browser transport.");
        if (!Number.isSafeInteger(nextGeneration))
          throw new Error("Stream generation limit reached.");
        const id = command.id;
        const generation = nextGeneration++;
        const delivery = new StreamDelivery({
          maxInFlightBytes: command.maxInFlightBytes ?? 1024 * 1024,
          onChunk(attempt, sequence, chunk) {
            reply.postMessage(
              {
                type: "stream-chunk",
                id,
                generation,
                attempt,
                sequence,
                chunk,
              } satisfies NetworkStreamChunkMessage,
              [chunk],
            );
          },
        });
        const socket = new ReconnectingSocket({
          ...command,
          transport,
          onOpen(attempt) {
            reply.postMessage({
              type: "stream-open",
              id,
              generation,
              attempt,
              response: { statusCode: 101, headers: {} },
            } satisfies NetworkStreamOpenMessage);
          },
          onChunk(attempt, chunk) {
            return delivery.send(attempt, chunk);
          },
          onEnd(attempt, cancelled) {
            reply.postMessage({
              type: "stream-end",
              id,
              generation,
              attempt,
              cancelled,
            } satisfies NetworkStreamEndMessage);
          },
          onError(attempt, error) {
            reply.postMessage({
              type: "stream-error",
              id,
              generation,
              attempt,
              error: describeError(error),
            } satisfies NetworkStreamErrorMessage);
          },
          onStopped() {
            sockets.delete(id);
            deliveries.delete(id);
            reply.postMessage({
              type: "stream-stopped",
              id,
              generation,
            } satisfies NetworkStreamStoppedMessage);
          },
        });
        deliveries.set(id, { generation, delivery });
        sockets.set(id, socket);
        void socket
          .run()
          .catch((error: unknown) =>
            console.error("WebSocket subscription failed:", error),
          );
        break;
      }

      case "send-socket": {
        if (deliveries.get(command.id)?.generation !== command.generation)
          throw new Error("WebSocket generation is no longer current.");
        const socket = sockets.get(command.id);
        if (socket === undefined) throw new Error("Unknown WebSocket ID.");
        socket.send(command.attempt, command.data);
        break;
      }

      case "stop-socket":
        await sockets.get(command.id)?.stop();
        break;
      case "start-loop": {
        const origin = new URL(command.origin).origin;
        const transport = transports.get(origin);

        if (transport === undefined) {
          throw new Error(`Unknown network origin: ${origin}`);
        }

        // Capture the ID used by response and failure notifications.
        const id = command.id;

        loops.start(id, {
          transport,
          request: command.request,
          retryDelayMs: command.retryDelayMs,
          intervalMs: command.intervalMs ?? 0,

          // Transfer the raw body without copying its buffer.
          onResponse(response) {
            reply.postMessage(
              {
                type: "loop-response",
                id,
                response,
              } satisfies NetworkLoopResponseMessage,
              [response.body],
            );
          },

          // Report request failures; the loop manages its retry delay.
          onError(error) {
            reply.postMessage({
              type: "loop-error",
              id,
              error: describeError(error),
            } satisfies NetworkLoopErrorMessage);
          },
        });

        break;
      }

      case "stop-loop":
        await loops.stop(command.id);
        break;

      case "start-subscription": {
        const origin = new URL(command.origin).origin;
        const transport = transports.get(origin);
        if (transport === undefined) {
          throw new Error(`Unknown network origin: ${origin}`);
        }
        if (!("openStream" in transport))
          throw new Error("This transport does not support SSE.");
        if (deliveries.has(command.id))
          throw new Error("Stream ID is already registered.");
        if (!Number.isSafeInteger(nextGeneration)) {
          throw new Error("SSE subscription generation limit reached.");
        }

        const id = command.id;
        const generation = nextGeneration++;
        const delivery = new StreamDelivery({
          maxInFlightBytes: command.maxInFlightBytes ?? 256 * 1024,
          onChunk(attempt, sequence, chunk) {
            reply.postMessage(
              {
                type: "stream-chunk",
                id,
                generation,
                attempt,
                sequence,
                chunk,
              } satisfies NetworkStreamChunkMessage,
              [chunk],
            );
          },
        });

        subscriptions.start(id, {
          transport: transport as StreamingNetworkTransport,
          request: command.request,
          headersTimeoutMs: command.headersTimeoutMs,
          retryDelayMs: command.retryDelayMs,
          onOpen(attempt, response) {
            reply.postMessage({
              type: "stream-open",
              id,
              generation,
              attempt,
              response,
            } satisfies NetworkStreamOpenMessage);
          },
          onChunk(attempt, chunk) {
            return delivery.send(attempt, chunk);
          },
          onEnd(attempt, cancelled) {
            reply.postMessage({
              type: "stream-end",
              id,
              generation,
              attempt,
              cancelled,
            } satisfies NetworkStreamEndMessage);
          },
          onError(attempt, error) {
            reply.postMessage({
              type: "stream-error",
              id,
              generation,
              attempt,
              error: describeError(error),
            } satisfies NetworkStreamErrorMessage);
          },
          onStopped() {
            if (deliveries.get(id)?.generation === generation) {
              deliveries.delete(id);
            }
            reply.postMessage({
              type: "stream-stopped",
              id,
              generation,
            } satisfies NetworkStreamStoppedMessage);
          },
        });
        deliveries.set(id, { generation, delivery });
        break;
      }

      case "stop-subscription":
        await subscriptions.stop(command.id);
        break;

      default:
        throw new Error("Unknown network command.");
    }

    // Confirm starts immediately and stops after the selected operation ends.
    reply.postMessage({
      type: "command-success",
      commandId: command.commandId,
    } satisfies NetworkCommandSuccessMessage);
  } catch (error) {
    reply.postMessage({
      type: "command-error",
      commandId: command.commandId,
      error: describeError(error),
    } satisfies NetworkCommandErrorMessage);
  }
}

// Accept commands from the application controller.
port.on("message", (command: NetworkWorkerCommand) => {
  void handleCommand(command).catch((error: unknown) => {
    console.error("Network worker command handling failed:", error);
    process.exitCode = 1;
  });
});

// Receive processing commands directly and return raw payloads on the same port.
data.consumerPort?.on("message", (command: NetworkWorkerCommand) => {
  void handleCommand(command, data.consumerPort!).catch((error: unknown) => {
    console.error("Network consumer command failed:", error);
    process.exitCode = 1;
  });
});

// Create one transport per origin and connect them concurrently.
try {
  if (!data || !Array.isArray(data.transports)) {
    throw new Error("Invalid network worker configuration.");
  }

  for (const options of data.transports) {
    const origin = new URL(options.origin).origin;

    if (transports.has(origin)) {
      throw new Error(`Duplicate network origin: ${origin}`);
    }

    transports.set(
      origin,
      options.engine === "browser"
        ? new BrowserTransport(options)
        : new HttpTransport(options),
    );
  }

  await Promise.all(
    [...transports.values()].map((transport) => transport.connect()),
  );

  // Confirm readiness only after all configured transports are connected.
  if (!stopping) {
    ready = true;

    const readyMessage: NetworkReadyMessage = {
      type: "network-ready",
      threadId,
    };

    port.postMessage(readyMessage);
  }
} catch (error) {
  const shutdownWasRequested = stopping;

  // Release partially initialized transports before reporting startup failure.
  try {
    await shutdown();
  } catch (shutdownError) {
    throw new AggregateError(
      [error, shutdownError],
      "Network worker startup and cleanup failed.",
    );
  }

  if (!shutdownWasRequested) {
    throw error;
  }
}
