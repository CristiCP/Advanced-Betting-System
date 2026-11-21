import { parentPort } from "node:worker_threads";
import { BrowserTransport } from "../../network/transports/browser-transport.js";
import { footballStatisticsConfig as config } from "../football-statistics.config.js";
import {
  scorealarmStatistics,
  statsStreamStatistics,
} from "../protocol/football-statistics.js";
import type {
  FootballStatisticsSample,
  FootballStatisticsTarget,
} from "../model/football-statistics.interfaces.js";

/** @file Fetches supplemental counters away from quote ingestion and aggregation. */

if (!parentPort) throw new Error("Football statistics require a worker.");
const port = parentPort;
const betanoTransport = new BrowserTransport({
  origin: "https://ro.betano.com",
  connectTimeoutMs: config.requestTimeoutMs,
  requestTimeoutMs: config.requestTimeoutMs,
  maxHttp1Connections: config.maxConcurrentPairs,
});
const abort = new AbortController();
const polls = new Set<Promise<void>>();
let targets: FootballStatisticsTarget[] = [];
let next = 0;
let active = 0;
let cooldownUntil = 0;
const inFlight = new Set<number>();
const lastRequested = new Map<number, number>();

port.on("message", (updated: FootballStatisticsTarget[] | "stop") => {
  if (updated === "stop") {
    clearInterval(timer);
    abort.abort();
    void Promise.allSettled([betanoTransport.close(), ...polls]).then(() =>
      port.close(),
    );
    return;
  }
  targets = updated;
  next = targets.length ? next % targets.length : 0;
  const ids = new Set(updated.map((target) => target.pairId));
  for (const id of lastRequested.keys())
    if (!ids.has(id)) lastRequested.delete(id);
  port.postMessage("targets-received");
});

const timer = setInterval(() => {
  const now = Date.now();
  if (active >= config.maxConcurrentPairs || now < cooldownUntil) return;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[next]!;
    next = (next + 1) % targets.length;
    if (
      inFlight.has(target.pairId) ||
      now - (lastRequested.get(target.pairId) ?? -Infinity) < config.intervalMs
    )
      continue;
    lastRequested.set(target.pairId, now);
    inFlight.add(target.pairId);
    active++;
    const pending = poll(target).finally(() => {
      inFlight.delete(target.pairId);
      active--;
      polls.delete(pending);
    });
    polls.add(pending);
    break;
  }
}, config.requestSpacingMs);

async function poll(target: FootballStatisticsTarget): Promise<void> {
  const [superbet, betano] = await Promise.all([
    readSuperbet(target.superbetId),
    readBetano(target.betanoId),
  ]);
  if (!abort.signal.aborted)
    port.postMessage({
      target,
      superbet,
      betano,
    } satisfies FootballStatisticsSample);
}

function backOff(status: number, retryAfter: string | null): void {
  if (status !== 429 && status !== 503) return;
  const delay =
    retryAfter && /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1_000
      : Date.parse(retryAfter ?? "") - Date.now();
  cooldownUntil = Math.max(
    cooldownUntil,
    Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 30_000),
  );
}

function timestamp(
  requestedAt: number,
  ageValue: string | null,
  dateValue: string | null,
): number {
  const age = Number(ageValue);
  const date = Date.parse(dateValue ?? "");
  return Math.min(
    requestedAt - (Number.isFinite(age) && age > 0 ? age * 1_000 : 0),
    Number.isFinite(date) ? date : requestedAt,
  );
}

async function readBetano(
  id: number,
): Promise<FootballStatisticsSample["betano"]> {
  try {
    const requestedAt = Date.now();
    // Use the same public HTTP transport as the Betano feed, with a separate pool.
    const r = await betanoTransport.request({
      path: `/api/statsstream/${id}/stats/detailed/`,
      method: "GET",
      headers: { accept: "application/json" },
      signal: abort.signal,
    });
    const header = (name: string): string | null => {
      const value = r.headers[name];
      return typeof value === "string" ? value : (value?.[0] ?? null);
    };
    backOff(r.statusCode, header("retry-after"));
    if (r.statusCode !== 200 || r.body.byteLength > config.maxResponseBytes)
      return null;
    const counts = statsStreamStatistics(
      JSON.parse(Buffer.from(r.body).toString("utf8")),
    );
    return Object.keys(counts).length
      ? {
          observedAt: timestamp(requestedAt, header("age"), header("date")),
          counts,
        }
      : null;
  } catch {
    return null;
  }
}

async function readSuperbet(
  id: number,
): Promise<FootballStatisticsSample["superbet"]> {
  try {
    const requestedAt = Date.now();
    const url = `https://scorealarm-stats.freetls.fastly.net/v2/soccer/fixtures/overview/rosuperbetsport/ro-RO?fixture-id=ax%3Amatch%3A${id}`;
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(config.requestTimeoutMs),
      ]),
    });
    backOff(response.status, response.headers.get("retry-after"));
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return null;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > config.maxResponseBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const payload: unknown = JSON.parse(
      Buffer.concat(chunks, size).toString("utf8"),
    );
    const counts = scorealarmStatistics(payload);
    const observedAt = timestamp(
      requestedAt,
      response.headers.get("age"),
      response.headers.get("date"),
    );
    return Object.keys(counts).length ? { observedAt, counts } : null;
  } catch {
    return null;
  }
}
