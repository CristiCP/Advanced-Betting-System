import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { LearnedTables } from "../matching/learning.js";
import { AggregationEngine } from "../processing/engine.js";
import { JsonlRecorder } from "../processing/recorder.js";
import { AggregationSession } from "../processing/session.js";
import type {
  AggregationStats,
  AggregationSportStats,
  AggregationWorkerCommand,
  AggregationWorkerData,
  AggregationWorkerMessage,
} from "../model/worker.interfaces.js";
import type { AggregationSport } from "../model/tennis.interfaces.js";
import type { AggregationMatchedEvent } from "../model/matching.interfaces.js";

/**
 * @file Receives provider batches on direct ports, matches and compares them, and reports to the main thread.
 */

if (isMainThread || parentPort === null)
  throw new Error("Aggregation must run in a worker.");
const port = parentPort;
const data: AggregationWorkerData = workerData;
const options = data.options;
const post = (message: AggregationWorkerMessage): void =>
  port.postMessage(message);
const reportError = (error: string): void => post({ type: "error", error });
const tables = new LearnedTables(options.learningPath, reportError);
const recorder = new JsonlRecorder(
  options.recordPath,
  options.recordBufferLimit,
  reportError,
);
const engine = new AggregationEngine(options, tables, {
  onRecord: (report) => recorder.write(report),
});
const engines = new Map<AggregationSport, AggregationEngine>([
  ["football", engine],
]);
if (data.ports.some((entry) => entry.sport === "tennis"))
  engines.set(
    "tennis",
    new AggregationEngine(
      options,
      new LearnedTables(null, reportError),
      { onRecord: (report) => recorder.write(report) },
      "tennis",
    ),
  );
// One generation per worker lifetime; reattachment will advance it.
const sessions = data.ports.map(
  ({ provider, sport = "football", port: providerPort }) =>
    new AggregationSession(
      provider,
      providerPort,
      1,
      options,
      {
        onError: (provider, error) =>
          post({ type: "error", error: `[${sport}] ${error}`, provider }),
      },
      engines.get(sport)!.sink(provider),
    ),
);
const timers: ReturnType<typeof setInterval>[] = [];
let started = false;
let stopping: Promise<void> | null = null;
let matchesStarted = false;
const lastMatches = new Map<AggregationSport, AggregationMatchedEvent[]>();

function stats(resetWindow = false): AggregationStats {
  const sports: Partial<Record<AggregationSport, AggregationSportStats>> = {};
  const sessionStats = sessions.map((session) => session.getStats(resetWindow));
  for (const [sport, target] of engines)
    sports[sport] = {
      sessions: Object.fromEntries(
        sessions.flatMap((session, i) =>
          (data.ports[i]!.sport ?? "football") === sport
            ? [[session.provider, sessionStats[i]]]
            : [],
        ),
      ),
      ...target.getStats(resetWindow),
    };
  return { ...sports.football!, sports, recorder: recorder.getStats() };
}

function flushReports(): void {
  const reports = [...engines.values()].flatMap((target) =>
    target.takeReports(),
  );
  if (reports.length) post({ type: "reports", reports });
  flushMatches();
}

// Let initial snapshots arrive before the first table; later updates share the existing report timer.
function flushMatches(): void {
  if (!data.publishMatches || !matchesStarted || stopping !== null) return;
  let changed = false;
  for (const [sport, target] of engines) {
    const matches = target.takeMatchedEvents();
    if (matches !== null) {
      changed = true;
      lastMatches.set(sport, matches);
    }
  }
  if (changed)
    post({ type: "matches", matches: [...lastMatches.values()].flat() });
}

async function start(): Promise<void> {
  if (started || stopping !== null)
    throw new Error("Aggregation worker has already started.");
  started = true;
  // Learned tables must be in place before the first pair is evaluated.
  await tables.load();
  if (stopping !== null) return;
  for (const session of sessions) session.start();
  timers.push(
    setInterval(() => {
      const now = Date.now();
      for (const target of engines.values()) target.sweep(now);
    }, options.sweepMs),
    setInterval(flushReports, options.reportIntervalMs),
    setInterval(() => {
      for (const target of engines.values()) target.scan(Date.now());
      matchesStarted = true;
      flushMatches();
      void tables.save();
      post({ type: "status", status: { kind: "stats", stats: stats(true) } });
    }, options.statsIntervalMs),
  );
  post({ type: "ready" });
}

// Close open opportunities, send the last reports, and persist files before the port closes.
function stop(): Promise<void> {
  stopping ??= (async () => {
    for (const timer of timers) clearInterval(timer);
    for (const target of engines.values()) target.stop(Date.now());
    for (const session of sessions) session.close();
    flushReports();
    await Promise.allSettled([recorder.close(), tables.save()]);
    port.close();
  })();
  return stopping;
}

async function handle(command: AggregationWorkerCommand): Promise<void> {
  if (command === "stop") return stop();
  if (command === "start") return start();
  if (!started || stopping !== null)
    throw new Error("Aggregation worker is not ready.");
  post({ type: "result", commandId: command.commandId, value: stats() });
}

port.on("message", (command: AggregationWorkerCommand) => {
  void handle(command).catch(async (error: unknown) => {
    post({ type: "fatal", error: String(error) });
    process.exitCode = 1;
    await stop();
  });
});
