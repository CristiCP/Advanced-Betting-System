import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { AggregationController } from "../dist/aggregation/controller.js";
import { AggregationOutbox } from "../dist/aggregation/adapter/outbox.js";
import { AggregationSession } from "../dist/aggregation/processing/session.js";
import {
  BatchWriter,
  fullStateBytes,
  lineKey,
  liveFlags,
} from "../dist/aggregation/protocol/wire.js";
import { identity, tick, until } from "./helpers/aggregation.mjs";

const key = lineKey(1, 10);
const options = {
  batchWindowMs: 5,
  maxEvents: 4,
  maxLines: 8,
  maxBatchBytes: 2 * fullStateBytes(4, 8),
  enabledConditions: ["D", "T"],
};

function open() {
  const { port1, port2: provider } = new MessageChannel();
  const errors = [];
  const session = new AggregationSession("superbet", port1, 1, options, {
    onError: (_, error) => errors.push(error),
  });
  session.start();
  return { session, provider, errors };
}

// Sends a hand-written batch and returns the aggregator's reply.
async function send(provider, sequence, write) {
  const writer = new BatchWriter();
  write(writer);
  const buffer = writer.finish("superbet", 1, sequence, Date.now());
  const reply = once(provider, "message", { signal: AbortSignal.timeout(2_000) });
  provider.postMessage({ type: "batch", generation: 1, sequence, buffer }, [
    buffer,
  ]);
  return (await reply)[0];
}

const valid = (writer) => {
  writer.writeReset();
  writer.eventIdentity(0, identity());
  writer.eventLive(0, liveFlags.live, 0, 0, 0);
  writer.lineDefine(0, 0, key);
  writer.value(0, 1.9, 1.9, 3);
};

test("the session attaches with the configured limits and acknowledges valid batches", async (t) => {
  const { session, provider } = open();
  t.after(() => session.close());
  const [attach] = await once(provider, "message", { signal: AbortSignal.timeout(2_000) });
  assert.deepEqual(attach, { type: "attach", generation: 1, options });
  const reply = await send(provider, 1, valid);
  assert.equal(reply.type, "ack");
  assert.equal(reply.sequence, 1);
  assert.ok(reply.buffer instanceof ArrayBuffer);
  const stats = session.getStats();
  assert.deepEqual(
    [stats.events, stats.lines, stats.batches, stats.operations, stats.values],
    [1, 1, 1, 4, 1],
  );
});

test("a sequence gap discards state and requires a reset", async (t) => {
  const { session, provider, errors } = open();
  t.after(() => session.close());
  await once(provider, "message", { signal: AbortSignal.timeout(2_000) });
  await send(provider, 1, valid);
  const gap = await send(provider, 3, (writer) => writer.value(0, 2, 2, 3));
  assert.deepEqual(gap, { type: "resync", generation: 1, sequence: 3 });
  assert.equal(session.getStats().lines, 0);
  const missingReset = await send(provider, 4, (writer) =>
    writer.eventIdentity(0, identity()),
  );
  assert.equal(missingReset.type, "resync");
  assert.equal((await send(provider, 5, valid)).type, "ack");
  assert.equal(session.getStats().resyncs, 2);
  assert.match(errors[0], /sequence gap/);
  assert.match(errors[1], /Expected reset/);
});

test("handle lifecycle violations reject the whole batch", async (t) => {
  const { session, provider } = open();
  t.after(() => session.close());
  await once(provider, "message", { signal: AbortSignal.timeout(2_000) });
  let sequence = 0;
  const violations = {
    "line for an undefined event": (w) => w.lineDefine(0, 2, key),
    "value for an undefined line": (w) => w.value(5, 2, 2, 3),
    "event released before its lines": (w) => w.eventRelease(0),
    "line defined twice": (w) => w.lineDefine(0, 0, key),
    "event handle out of range": (w) => w.eventIdentity(4, identity()),
    "line handle out of range": (w) => w.lineDefine(8, 0, key),
    "reset after operations": (w) => {
      w.eventLive(0, 0, 0, 0, 0);
      w.writeReset();
    },
  };
  for (const [name, violation] of Object.entries(violations)) {
    await send(provider, ++sequence, valid);
    const reply = await send(provider, ++sequence, violation);
    assert.equal(reply.type, "resync", name);
    // Nothing from the rejected batch or the earlier state remains.
    assert.equal(session.getStats().events, 0, name);
  }
});

test("a malformed envelope closes the link", async () => {
  const { session, provider, errors } = open();
  await once(provider, "message", { signal: AbortSignal.timeout(2_000) });
  const closed = once(provider, "close", { signal: AbortSignal.timeout(2_000) });
  provider.postMessage({ type: "batch", generation: 1, sequence: 1 });
  await closed;
  assert.deepEqual(errors, ["Invalid aggregation batch message."]);
  assert.equal(session.getStats().connected, false);
});

test("an outbox and a session keep the same state across releases", async (t) => {
  const { port1, port2 } = new MessageChannel();
  const session = new AggregationSession("betano", port1, 1, options, {
    onError: (_, error) => assert.fail(error),
  });
  const outbox = new AggregationOutbox(port2, "betano", {
    onResync: () => {
      for (const id of [7, 8]) {
        outbox.setEvent(identity(id));
        outbox.setLive(id, {
          live: true,
          suspended: false,
          homeScore: 0,
          awayScore: 0,
          clockSeconds: 60,
          clockRunning: true,
        });
        outbox.setLine(id, key, 1.9, 1.9, true, true);
        outbox.setLine(id, lineKey(2, 0), 1.5, 2.5, true, false);
      }
    },
  });
  t.after(() => session.close());
  session.start();
  await until(() => session.getStats().lines === 4);
  outbox.releaseLine(7, key);
  outbox.releaseEvent(8);
  await until(
    () => session.getStats().events === 1 && session.getStats().lines === 1,
  );
  await until(() => !outbox.getStats().inFlight);
  assert.deepEqual(
    { events: outbox.getStats().events, lines: outbox.getStats().lines },
    { events: 1, lines: 1 },
  );
});

test("the controller validates options and ports", async () => {
  assert.throws(() => new AggregationController({ maxEvents: 0 }), /maxEvents/);
  assert.throws(
    () => new AggregationController({ maxBatchBytes: 1_024 }),
    /inconsistent/,
  );
  const controller = new AggregationController();
  controller.createPort("superbet");
  assert.throws(() => controller.createPort("superbet"), /already exists/);
  assert.throws(() => controller.createPort("unibet"), /Unknown/);
  await controller.stop();
  assert.throws(() => controller.createPort("betano"), /before start/);
});

test("the controller runs the worker and reports provider links", async () => {
  const errors = [];
  const controller = new AggregationController(
    { statsIntervalMs: 50 },
    { onError: (error) => errors.push(error) },
  );
  const outbox = new AggregationOutbox(controller.createPort("superbet"), "superbet", {
    onResync: () => {
      outbox.setEvent(identity(7));
      outbox.setLine(7, key, 1.9, 1.9, true, true);
    },
  });
  await controller.start();
  try {
    await until(async () => (await controller.getStats()).sessions.superbet?.lines === 1);
    const stats = (await controller.getStats()).sessions.superbet;
    assert.equal(stats.connected, true);
    assert.equal(stats.events, 1);
    assert.ok(stats.batches >= 1);
  } finally {
    await controller.stop();
  }
  await tick(20);
  assert.equal(outbox.active, false);
  assert.deepEqual(errors, []);
  await assert.rejects(controller.getStats(), /not ready/);
});
