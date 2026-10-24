import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { NetworkPortClient } from "../../../network/workers/port-client.js";
import { AggregationOutbox } from "../../../aggregation/adapter/outbox.js";
import { SuperbetFeed } from "../processing/feed.js";
import type {
  SuperbetWorkerCommand,
  SuperbetWorkerData,
  SuperbetWorkerMessage,
} from "../model/worker.interfaces.js";

/**
 * @file Processes Superbet gzip, SSE messages, and versioned odds on a dedicated thread.
 */

if (isMainThread || parentPort === null)
  throw new Error("Superbet processing must run in a worker.");
const port = parentPort;
const data: SuperbetWorkerData = workerData;
const post = (message: SuperbetWorkerMessage): void =>
  port.postMessage(message);
// Projection adapters will feed the outbox; without a port the provider runs unchanged.
const aggregation = data.aggregationPort
  ? new AggregationOutbox(data.aggregationPort, "superbet", {
      onError: (error) =>
        post({ type: "error", error: `Aggregation: ${error}` }),
    })
  : null;
const client = new NetworkPortClient(data.networkPort, (message) =>
  feed.handle(message),
);
const feed = new SuperbetFeed(client, data.options, {
  onEvents: (events) => post({ type: "events", events }),
  onSnapshot: (snapshot) => {
    if (data.publishSnapshots) post({ type: "snapshot", snapshot });
  },
  onUpdate: (update) => {
    if (data.publishUpdates) post({ type: "update", update });
  },
  ...(data.publishFootballSnapshots
    ? {
        onFootballSnapshot: (snapshot) =>
          post({ type: "football-snapshot", snapshot }),
      }
    : {}),
  ...(data.publishFootballUpdates
    ? {
        onFootballUpdate: (change) => post({ type: "football-update", change }),
      }
    : {}),
  onRemove: (eventId) => post({ type: "removed", eventId }),
  onStatus: (status) => post({ type: "status", status }),
  onError: (error, eventId) =>
    post({
      type: "error",
      error,
      ...(eventId === undefined ? {} : { eventId }),
    }),
});
let started = false;
let stopping = false;

// Keep query handling independent of ongoing snapshot requests.
async function handle(command: SuperbetWorkerCommand): Promise<void> {
  if (command === "stop") {
    if (stopping) return;
    stopping = true;
    try {
      await feed.stop();
    } finally {
      aggregation?.close();
      client.close();
      port.close();
    }
    return;
  }
  if (command === "start") {
    if (started || stopping)
      throw new Error("Superbet worker has already started.");
    started = true;
    await feed.start();
    if (!stopping) post({ type: "ready" });
    return;
  }
  if (!started || stopping) throw new Error("Superbet worker is not ready.");
  try {
    let value: unknown;
    switch (command.operation) {
      case "events":
        value = feed.getEvents();
        break;
      case "snapshot":
        value = feed.getSnapshot(command.eventId!);
        break;
      case "football-snapshot":
        value = feed.getFootballSnapshot(command.eventId!);
        break;
      case "stats":
        value = feed.getStats();
        break;
      case "reconnect":
        await feed.reconnect();
        break;
    }
    post({ type: "result", commandId: command.commandId, value });
  } catch (error) {
    post({
      type: "result",
      commandId: command.commandId,
      error: String(error),
    });
  }
}

port.on("message", (command: SuperbetWorkerCommand) => {
  void handle(command).catch(async (error: unknown) => {
    post({ type: "fatal", error: String(error) });
    process.exitCode = 1;
    try {
      await feed.stop();
    } finally {
      aggregation?.close();
      client.close();
      port.close();
    }
  });
});
