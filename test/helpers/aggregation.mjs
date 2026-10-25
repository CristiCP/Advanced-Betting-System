import { readBatch, readHeader } from "../../dist/aggregation/protocol/wire.js";

// Shared fixtures for aggregation tests; not a test file itself.
export const identity = (eventId = 7, extra = {}) => ({
  eventId,
  betradarId: 61_234_567,
  startsAt: 1_792_850_400_000,
  competitionId: 106,
  categoryId: 0,
  home: "Steaua București",
  away: "Garðabær",
  ...extra,
});

export function recorder() {
  const calls = [];
  return {
    calls,
    reset: () => calls.push(["reset"]),
    eventIdentity: (event, value) => calls.push(["identity", event, value]),
    eventLive: (...args) => calls.push(["live", ...args]),
    eventTennis: (...args) => calls.push(["tennis", ...args]),
    eventRelease: (event) => calls.push(["event-release", event]),
    lineDefine: (...args) => calls.push(["define", ...args]),
    lineRelease: (line) => calls.push(["line-release", line]),
    value: (...args) => calls.push(["value", ...args]),
  };
}

export function decode(buffer) {
  const header = readHeader(buffer);
  const sink = recorder();
  readBatch(buffer, header, sink);
  return { header, calls: sink.calls };
}

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Condition was not reached.");
    await tick(5);
  }
}
