import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { BetanoFeed } from "../dist/providers/betano/processing/feed.js";
import { betanoConfig } from "../dist/providers/betano/config.js";
import { feedHarness, feedSnapshot } from "./helpers/betano-feed.mjs";
import { until } from "./helpers/aggregation.mjs";
import lz4 from "lz4js";

test("server cooldown is shared across snapshots and shutdown cancels retries", async () => {
  let feed;
  let requests = 0;
  let sequence = 0;
  let generation = 0;
  const sockets = new Map();
  const events = {
    11: { id: 11, sportId: "FOOT", isLive: true, marketIdList: [] },
    12: { id: 12, sportId: "TENN", isLive: true, marketIdList: [] },
  };
  const chunk = (id, record) => {
    const current = sockets.get(id);
    if (!current) return;
    feed.handle({
      type: "stream-chunk",
      id,
      generation: current.generation,
      attempt: 1,
      sequence: ++sequence,
      chunk: new TextEncoder().encode(record + "\x1e").buffer,
    });
  };
  const network = {
    async command(command) {
      if (command.type === "request") {
        requests++;
        const overview = command.request.path.includes("/overview/");
        return {
          type: "request-response",
          commandId: 1,
          response: {
            statusCode: overview ? 200 : 429,
            headers: { "retry-after": "60" },
            body: new TextEncoder().encode(
              JSON.stringify(overview ? { events } : {}),
            ).buffer,
          },
        };
      }
      if (command.type === "start-socket") {
        const current = { generation: ++generation };
        sockets.set(command.id, current);
        queueMicrotask(() =>
          feed.handle({
            type: "stream-open",
            id: command.id,
            generation: current.generation,
            attempt: 1,
            response: { statusCode: 101, headers: {} },
          }),
        );
      }
      if (command.type === "stop-socket") sockets.delete(command.id);
      if (command.type === "send-socket") {
        const message = JSON.parse(command.data.slice(0, -1));
        if (message.target === "joinLiveEventGroup")
          for (const eventId of message.arguments[0].eventIds)
            queueMicrotask(() => chunk(command.id, JSON.stringify({
              type: 1, target: "OnActiveLiveEventSplitVersion", arguments: [{
                eventId, version: 1, includeEvent: true, includeMarkets: true, includeIncidents: false,
              }],
            })));
        queueMicrotask(() =>
          chunk(
            command.id,
            JSON.stringify(
              message.protocol
                ? {}
                : { type: 3, invocationId: message.invocationId },
            ),
          ),
        );
      }
      return { type: "command-success", commandId: 1 };
    },
    post() {},
  };
  const errors = [];
  feed = new BetanoFeed(
    network,
    { ...betanoConfig, retryDelayMs: 5 },
    {
      onEvents() {},
      onSnapshot() {},
      onUpdate() {},
      onRemove() {},
      onStatus() {},
      onError: (error) => errors.push(error),
    },
  );
  try {
    await feed.start();
    await delay(40);
    assert.ok(errors.some((error) => error.includes("429")));
    const before = requests;
    const errorCount = errors.length;
    for (let i = 0; i < 5; i++) feed.refreshDiscovery();
    await delay(40);
    assert.equal(requests, before);
    assert.equal(errors.length, errorCount);
    assert.equal(feed.getStats().synchronizedEvents, 0);
  } finally {
    await feed.stop();
  }
  const stoppedRequests = requests;
  await delay(20);
  assert.equal(requests, stoppedRequests);
  assert.equal(sockets.size, 0);
});

test("snapshot requests wait for the selected audience confirmation", async (t) => {
  const f = feedHarness(t);
  f.controls.automaticVersions = false;
  await f.feed.start();
  await delay(10);
  assert.equal(f.requests.length, 0);
  f.version();
  await until(() => f.feed.getStats().synchronizedEvents === 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.snapshots[0].version, 10);
  assert.equal(f.snapshots[0].restVersion, 13);
});

test("a late HTTP response cannot restore odds from a disconnected connection attempt", async (t) => {
  const pending = Promise.withResolvers();
  const f = feedHarness(t, async (n) => n === 1 ? pending.promise : feedSnapshot());
  await f.feed.start();
  await until(() => f.requests.length === 1);
  f.disconnect();
  pending.resolve(feedSnapshot());
  await until(() => !f.feed.store.events.get(11).loading);
  assert.equal(f.feed.store.getSnapshot(11), null);
  assert.equal(f.snapshots.length, 0);
  assert.equal(f.statuses.filter((s) => s.kind === "disconnected").length, 1);
  assert.match(f.errors[0], /betano:events:1: WebSocket closed/);
  f.controls.automaticVersions = false;
  f.reopen();
  await delay(15);
  assert.equal(f.feed.store.getSnapshot(11), null);
  assert.equal(f.requests.length, 1);
  f.version();
  await until(() => f.feed.getStats().synchronizedEvents === 1);
  assert.equal(f.requests.length, 2);
});

test("unchanged reconnects reuse confirmed state while missing versions require a new baseline", async (t) => {
  let version = 10;
  const f = feedHarness(t, async () => feedSnapshot(version), { socketFailureThreshold: 10 });
  await f.feed.start();
  await until(() => f.feed.getStats().synchronizedEvents === 1);
  f.disconnect();
  assert.equal(f.feed.store.getSnapshot(11), null);
  f.reopen();
  await until(() => f.feed.getStats().synchronizedEvents === 1);
  assert.equal(f.requests.length, 1);
  version = 12;
  f.controls.version = 12;
  f.disconnect();
  f.reopen();
  await until(() => f.feed.store.getSnapshot(11)?.version === 12);
  assert.equal(f.requests.length, 2);
});

test("confirmation of a different audience cannot unlock snapshot requests", async (t) => {
  const f = feedHarness(t);
  f.controls.automaticVersions = false;
  await f.feed.start();
  await delay(10);
  f.version(10, { includeIncidents: true });
  await until(() => f.errors.length > 0);
  assert.match(f.errors[0], /different event audience/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.feed.store.getSnapshot(11), null);
});

test("split price updates advance the normalized sequence without REST repairs", async (t) => {
  const f = feedHarness(t);
  await f.feed.start();
  await until(() => f.feed.getStats().synchronizedEvents === 1);
  const diffs = [{ eventId: 11, version: 11, type: 100, payload: {
    selectionChanges: { 100: [{ id: 200, price: 3 }] },
  } }];
  f.chunk("betano:events:1", {
    type: 1, target: "NewLiveEventSplitDiff",
    arguments: [Buffer.from(lz4.compress(Buffer.from(JSON.stringify(diffs)))).toString("base64")],
  });
  assert.equal(f.feed.store.getSnapshot(11).version, 11);
  assert.equal(f.feed.store.getSnapshot(11).selections[200].price, 3);
  assert.equal(f.requests.length, 1);
});

test("legacy full-version messages cannot enter the split sequence", async (t) => {
  const f = feedHarness(t);
  f.controls.automaticVersions = false;
  await f.feed.start();
  await delay(10);
  f.chunk("betano:events:1", { type: 1, target: "OnActiveLiveEventVersion", arguments: [{ eventId: 11, version: 999 }] });
  assert.match(f.errors[0], /full-audience message/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.feed.store.getSnapshot(11), null);
});
