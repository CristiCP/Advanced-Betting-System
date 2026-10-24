import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { AggregationSession } from "../processing/session.js";
import type {
  AggregationStats,
  AggregationWorkerCommand,
  AggregationWorkerData,
  AggregationWorkerMessage,
} from "../model/worker.interfaces.js";

/**
 * @file Receives provider batches on direct ports and reports aggregation state to the main thread.
 */

if (isMainThread || parentPort === null)
  throw new Error("Aggregation must run in a worker.");
const port = parentPort;
const data: AggregationWorkerData = workerData;
const post = (message: AggregationWorkerMessage): void =>
  port.postMessage(message);
// One generation per worker lifetime; reattachment will advance it.
const sessions = data.ports.map(
  ({ provider, port: providerPort }) =>
    new AggregationSession(provider, providerPort, 1, data.options, {
      onError: (provider, error) => post({ type: "error", error, provider }),
    }),
);
let statsTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let stopping = false;

function stats(resetWindow = false): AggregationStats {
  return Object.fromEntries(
    sessions.map((session) => [
      session.provider,
      session.getStats(resetWindow),
    ]),
  );
}

function stop(): void {
  if (stopping) return;
  stopping = true;
  if (statsTimer !== null) clearInterval(statsTimer);
  statsTimer = null;
  for (const session of sessions) session.close();
  port.close();
}

function handle(command: AggregationWorkerCommand): void {
  if (command === "stop") {
    stop();
    return;
  }
  if (command === "start") {
    if (started || stopping)
      throw new Error("Aggregation worker has already started.");
    started = true;
    for (const session of sessions) session.start();
    statsTimer = setInterval(
      () => post({ type: "status", status: { kind: "stats", stats: stats(true) } }),
      data.options.statsIntervalMs,
    );
    post({ type: "ready" });
    return;
  }
  if (!started || stopping) throw new Error("Aggregation worker is not ready.");
  post({ type: "result", commandId: command.commandId, value: stats() });
}

port.on("message", (command: AggregationWorkerCommand) => {
  try {
    handle(command);
  } catch (error) {
    post({ type: "fatal", error: String(error) });
    process.exitCode = 1;
    stop();
  }
});
