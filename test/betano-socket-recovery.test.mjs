import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { betanoConfig } from "../dist/providers/betano/config.js";
import { shouldIsolateSocket } from "../dist/providers/betano/processing/socket-recovery.js";
import { feedHarness, feedEvent, feedSnapshot } from "./helpers/betano-feed.mjs";
import { until } from "./helpers/aggregation.mjs";

function snapshot(command, version = 10) {
  const id = Number(command.request.path.match(/events\/(\d+)/)[1]);
  return { ...feedSnapshot(version), event: { ...feedEvent, id } };
}

function addEvents(f, ids) {
  f.controls.events = Object.fromEntries(ids.map(id => [id, { ...feedEvent, id }]));
}

async function failTwice(f, id) {
  f.disconnect(id);
  f.reopen(id);
  await until(() => f.feed.getStats().connectedSockets === f.sockets.size);
  f.disconnect(id);
}

test("only repeated confirmed 1005 closes isolate; duplicates and stable sessions do not accumulate failures", () => {
  const state = () => ({
    events: new Set([11, 12]), isolated: false, confirmedOnDisconnect: true,
    failedAttempt: 0, attempt: 1, openedAt: 1000, failures: 0,
  });
  const error = "WebSocket closed (1005).";
  const s = state();
  assert.equal(shouldIsolateSocket(s, betanoConfig, error, 2000), false);
  assert.equal(shouldIsolateSocket(s, betanoConfig, error, 2001), false);
  assert.equal(s.failures, 1);
  const stableOther = { ...state(), failures: 1 };
  assert.equal(shouldIsolateSocket(stableOther, betanoConfig, "WebSocket closed (1006).", 63000), false);
  assert.equal(stableOther.failures, 0);
  s.attempt++;
  s.openedAt = 3000;
  assert.equal(shouldIsolateSocket(s, betanoConfig, error, 4000), true);
  s.attempt++;
  assert.equal(shouldIsolateSocket(s, betanoConfig, error, 63000), false);
  assert.equal(s.failures, 1);
  for (const change of [{ isolated: true }, { confirmedOnDisconnect: false }, { events: new Set() }]) {
    const candidate = { ...state(), failures: 10, ...change };
    assert.equal(shouldIsolateSocket(candidate, betanoConfig, error, 2000), false);
  }
  for (const other of ["WebSocket became idle.", "WebSocket closed (1006).", "WebSocket consumer byte limit reached; resynchronization required."]) {
    const candidate = { ...state(), failures: 10 };
    assert.equal(shouldIsolateSocket(candidate, betanoConfig, other, 2000), false);
  }
});

test("a poisoned branch splits without restarting recovered peers or mixing new discovery members", async (t) => {
  const f = feedHarness(t, async (_, command) => snapshot(command));
  addEvents(f, [11, 12, 13, 14]);
  await f.feed.start();
  await until(() => f.feed.getStats().synchronizedEvents === 4);
  f.disconnect();
  assert.equal(f.commands.filter(c => c.type === "start-socket").length, 2);
  assert.equal(f.feed.store.getSnapshot(11), null);
  f.reopen();
  await until(() => f.feed.getStats().synchronizedEvents === 4);
  f.disconnect();
  await until(() => f.feed.getStats().socketSplits === 1 && f.feed.getStats().synchronizedEvents === 4);
  assert.ok(!f.sockets.has("betano:events:1"));
  const healthy = f.socketFor(11), bad = f.socketFor(14);
  assert.notEqual(healthy, bad);
  const healthyGeneration = f.sockets.get(healthy).generation;
  const healthyInvalidations = f.statuses.filter(s => s.kind === "event-stale" && s.eventId === 11).length;
  await failTwice(f, bad);
  await until(() => f.feed.getStats().socketSplits === 2 && f.feed.getStats().synchronizedEvents === 4);
  assert.equal(f.sockets.get(healthy).generation, healthyGeneration);
  assert.equal(f.statuses.filter(s => s.kind === "event-stale" && s.eventId === 11).length, healthyInvalidations);
  assert.equal(f.requests.length, 4, "confirmed unchanged snapshots should be reused after partitioning");
  const isolated = f.socketFor(14);
  assert.notEqual(isolated, f.socketFor(13));
  assert.equal(f.commands.find(c => c.type === "start-socket" && c.id === isolated).retryDelayMs, 30000);
  const starts = f.commands.filter(c => c.type === "start-socket").length;
  await failTwice(f, isolated);
  assert.equal(f.commands.filter(c => c.type === "start-socket").length, starts);
  assert.equal(f.feed.store.getSnapshot(14), null);
  assert.ok(f.feed.store.getSnapshot(11));
  assert.equal(f.errorEvents.at(-1).eventId, 14);
  assert.match(f.errorEvents.at(-1).error, /Isolated event; retry delay 30000ms/);
  f.reopen(isolated);
  await until(() => f.feed.getStats().synchronizedEvents === 4);
  f.controls.events[15] = { ...feedEvent, id: 15 };
  f.feed.refreshDiscovery();
  await until(() => f.feed.getStats().synchronizedEvents === 5);
  assert.notEqual(f.socketFor(15), healthy);
  assert.notEqual(f.socketFor(15), isolated);
  f.feed.store.remove(14);
  await until(() => !f.sockets.has(isolated));
  assert.equal(f.feed.store.getSnapshot(14), null);
});

test("partitioning fences delayed HTTP and late messages from retired sockets", async (t) => {
  const pending = Promise.withResolvers();
  let held = false;
  const f = feedHarness(t, async (_, command) => {
    if (command.request.path.includes("events/12/") && !held) {
      held = true;
      return pending.promise;
    }
    return snapshot(command);
  });
  addEvents(f, [11, 12]);
  await f.feed.start();
  await until(() => held && f.feed.getStats().synchronizedEvents === 1);
  const old = { ...f.sockets.get("betano:events:1") };
  await failTwice(f, "betano:events:1");
  await until(() => f.feed.getStats().socketSplits === 1);
  pending.resolve({ ...feedSnapshot(999), event: { ...feedEvent, id: 12 } });
  await until(() => f.feed.getStats().synchronizedEvents === 2);
  f.feed.handle({ type: "stream-chunk", id: "betano:events:1", ...old, sequence: 9999,
    chunk: new TextEncoder().encode(JSON.stringify({ type: 1, target: "OnActiveLiveEventSplitVersion", arguments: [{ eventId: 11, version: 9999 }] }) + "\x1e").buffer });
  assert.equal(f.feed.store.getSnapshot(11).version, 10);
  assert.equal(f.feed.store.getSnapshot(12).version, 10);
  assert.ok(!f.snapshots.some(s => s.version === 999));
});

test("a repeatedly failing singleton switches to isolated retries and can recover on the same event", async (t) => {
  const f = feedHarness(t);
  await f.feed.start();
  await until(() => f.feed.getStats().synchronizedEvents === 1);
  const originalGeneration = f.sockets.get("betano:events:1").generation;
  await failTwice(f, "betano:events:1");
  await until(() => f.feed.getStats().isolatedSockets === 1 && f.feed.getStats().synchronizedEvents === 1);
  assert.notEqual(f.sockets.get("betano:events:1").generation, originalGeneration);
  assert.equal(f.commands.filter(c => c.type === "start-socket" && c.id === "betano:events:1").at(-1).retryDelayMs, 30000);
  assert.equal(f.feed.getStats().socketSplits, 0);
  const starts = f.commands.filter(c => c.type === "start-socket").length;
  f.disconnect();
  assert.equal(f.feed.store.getSnapshot(11), null);
  f.reopen();
  await until(() => f.feed.getStats().synchronizedEvents === 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.commands.filter(c => c.type === "start-socket").length, starts);
});

test("shutdown waits for an in-flight partition and never opens its children", async (t) => {
  const f = feedHarness(t, async (_, command) => snapshot(command));
  addEvents(f, [11, 12]);
  await f.feed.start();
  await until(() => f.feed.getStats().synchronizedEvents === 2);
  const pending = Promise.withResolvers();
  const command = f.network.command.bind(f.network);
  f.network.command = async c => {
    if (c.type === "stop-socket" && c.id === "betano:events:1") await pending.promise;
    return command(c);
  };
  await failTwice(f, "betano:events:1");
  const stopping = f.feed.stop();
  pending.resolve();
  await stopping;
  await delay(15);
  assert.equal(f.sockets.size, 0);
  assert.equal(f.commands.filter(c => c.type === "start-socket").length, 2);
});

test("an event removed while its parent is stopping is not resurrected in a child socket", async (t) => {
  const f = feedHarness(t, async (_, command) => snapshot(command));
  addEvents(f, [11, 12]);
  await f.feed.start();
  await until(() => f.feed.getStats().synchronizedEvents === 2);
  const pending = Promise.withResolvers();
  const command = f.network.command.bind(f.network);
  f.network.command = async c => {
    if (c.type === "stop-socket" && c.id === "betano:events:1") await pending.promise;
    return command(c);
  };
  await failTwice(f, "betano:events:1");
  f.feed.store.remove(12);
  delete f.controls.events[12];
  pending.resolve();
  await until(() => f.feed.getStats().synchronizedEvents === 1 && f.socketFor(11) !== "betano:events:1");
  assert.equal(f.socketFor(12), undefined);
  assert.equal(f.feed.getStats().events, 1);
});
