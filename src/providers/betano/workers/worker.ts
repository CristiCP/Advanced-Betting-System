import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { NetworkPortClient } from "../../../network/workers/port-client.js";
import { AggregationOutbox } from "../../../aggregation/adapter/outbox.js";
import { ProjectionAggregationAdapter } from "../../../aggregation/adapter/projection.js";
import { tennisMarketMapping } from "../../../aggregation/tennis-mapping.config.js";
import { betanoTennisCodec } from "../processing/tennis-aggregation.js";
import type {
  BetanoTennisEvent,
  BetanoTennisLine,
} from "../model/tennis-projection.interfaces.js";
import { FootballAggregationAdapter } from "../../../aggregation/adapter/football.js";
import { betanoFootballCodec } from "../processing/aggregation.js";
import type {
  BetanoFootballEvent,
  BetanoFootballLine,
} from "../model/football-projection.interfaces.js";
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
// The adapter turns football projections into canonical lines; without a port the provider runs unchanged.
let adapter: FootballAggregationAdapter<
  BetanoFootballEvent,
  BetanoFootballLine
> | null = null;
const aggregation = data.aggregationPort
  ? new AggregationOutbox(data.aggregationPort, "betano", {
      onResync: () => aggregate((target) => target.resync()),
      onError: (error) =>
        post({ type: "error", error: `Aggregation: ${error}` }),
    })
  : null;

let tennisAdapter: ProjectionAggregationAdapter<
  BetanoTennisEvent,
  BetanoTennisLine
> | null = null;
const tennisAggregation = data.tennisAggregationPort
  ? new AggregationOutbox(data.tennisAggregationPort, "betano", {
      onResync: () => aggregateTennis((target) => target.resync()),
      onError: (error) =>
        post({ type: "error", error: `Tennis aggregation: ${error}` }),
    })
  : null;

function aggregateTennis(
  action: (
    target: ProjectionAggregationAdapter<BetanoTennisEvent, BetanoTennisLine>,
  ) => void,
): void {
  if (tennisAdapter === null) return;
  try {
    action(tennisAdapter);
  } catch (error) {
    post({
      type: "error",
      error: `Tennis aggregation adapter failed: ${String(error)}`,
    });
    tennisAdapter = null;
    tennisAggregation?.close();
  }
}

// An adapter failure must never break odds processing: report it and drop only the aggregation link.
function aggregate(
  action: (
    target: FootballAggregationAdapter<BetanoFootballEvent, BetanoFootballLine>,
  ) => void,
): void {
  if (adapter === null) return;
  try {
    action(adapter);
  } catch (error) {
    post({
      type: "error",
      error: `Aggregation adapter failed: ${String(error)}`,
    });
    adapter = null;
    aggregation?.close();
  }
}
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
  ...(data.publishFootballSnapshots || aggregation
    ? {
        onFootballSnapshot: (snapshot) => {
          aggregate((target) => target.install(snapshot));
          if (data.publishFootballSnapshots)
            post({ type: "football-snapshot", snapshot });
        },
      }
    : {}),
  ...(data.publishFootballUpdates || aggregation
    ? {
        onFootballUpdate: (change) => {
          aggregate((target) => target.update(change));
          if (data.publishFootballUpdates)
            post({ type: "football-update", change });
        },
      }
    : {}),
  onRemove: (eventId) => post({ type: "removed", eventId }),
  ...(data.publishTennisSnapshots || tennisAggregation
    ? {
        onTennisSnapshot: (snapshot) => {
          aggregateTennis((target) => target.install(snapshot));
          if (data.publishTennisSnapshots)
            post({ type: "tennis-snapshot", snapshot });
        },
      }
    : {}),
  ...(data.publishTennisUpdates || tennisAggregation
    ? {
        onTennisUpdate: (change) => {
          aggregateTennis((target) => target.update(change));
          if (data.publishTennisUpdates)
            post({ type: "tennis-update", change });
        },
      }
    : {}),
  onStatus: (status) => post({ type: "status", status }),
  onError: (error, eventId) =>
    post({
      type: "error",
      error,
      ...(eventId === undefined ? {} : { eventId }),
    }),
});
if (aggregation !== null)
  adapter = new FootballAggregationAdapter(
    aggregation,
    betanoFootballCodec,
    () => feed.getFootballSnapshots(),
  );
if (tennisAggregation !== null)
  tennisAdapter = new ProjectionAggregationAdapter(
    tennisAggregation,
    betanoTennisCodec,
    () => feed.getTennisSnapshots(),
    tennisMarketMapping,
  );
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
      aggregation?.close();
      tennisAggregation?.close();
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
      case "football-snapshot":
        value = feed.getFootballSnapshot(command.eventId!);
        break;
      case "tennis-snapshot":
        value = feed.getTennisSnapshot(command.eventId!);
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
      aggregation?.close();
      tennisAggregation?.close();
      client.close();
      port.close();
    }
  });
});
