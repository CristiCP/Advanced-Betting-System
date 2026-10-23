import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { NetworkPortClient } from "../../../network/workers/port-client.js";
import { BetanoFeed } from "../processing/feed.js";
import type {
  BetanoWorkerCommand,
  BetanoWorkerData,
  BetanoWorkerMessage,
} from "../model/worker.interfaces.js";

/**
 * @file Processes Betano snapshots and compressed pushes on a dedicated thread.
 */

if (isMainThread || parentPort === null)
  throw new Error("Betano processing must run in a worker.");
const port = parentPort;
const data: BetanoWorkerData = workerData;
const post = (message: BetanoWorkerMessage): void => port.postMessage(message);
const client = new NetworkPortClient(data.networkPort, (message) =>
  feed.handle(message),
);
const feed = new BetanoFeed(client, data.options, {
  onEvents: (events) => post({ type: "events", events }),
  onSnapshot: (snapshot) => {
    if (data.publishSnapshots) post({ type: "snapshot", snapshot });
  },
  onUpdate: (diff) => {
    if (data.publishUpdates) post({ type: "update", diff });
  },
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
async function handle(command: BetanoWorkerCommand): Promise<void> {
  if (command === "stop") {
    if (stopping) return;
    stopping = true;
    try {
      await feed.stop();
    } finally {
      client.close();
      port.close();
    }
    return;
  }
  if (command === "start") {
    if (started || stopping)
      throw new Error("Betano worker has already started.");
    started = true;
    await feed.start();
    if (!stopping) post({ type: "ready" });
    return;
  }
  if (!started || stopping) throw new Error("Betano worker is not ready.");
  try {
    let value: unknown;
    switch (command.operation) {
      case "events":
        value = feed.getEvents();
        break;
      case "snapshot":
        value = feed.store.getSnapshot(command.eventId!);
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

port.on("message", (command: BetanoWorkerCommand) => {
  void handle(command).catch(async (error: unknown) => {
    post({ type: "fatal", error: String(error) });
    process.exitCode = 1;
    try {
      await feed.stop();
    } finally {
      client.close();
      port.close();
    }
  });
});
