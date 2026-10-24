import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { AggregationOutbox } from "../dist/aggregation/adapter/outbox.js";
import { fullStateBytes, lineKey } from "../dist/aggregation/protocol/wire.js";
import { decode, identity, tick } from "./helpers/aggregation.mjs";

const key = lineKey(1, 10);
const other = lineKey(1, 14);
const options = (extra = {}) => ({
  batchWindowMs: 5,
  maxEvents: 4,
  maxLines: 8,
  maxBatchBytes: 2 * fullStateBytes(4, 8),
  ...extra,
});
const live = (extra = {}) => ({
  live: true,
  suspended: false,
  homeScore: 0,
  awayScore: 0,
  clockSeconds: 600,
  ...extra,
});

function connect(onResync = () => {}, errors = []) {
  const { port1: aggregator, port2 } = new MessageChannel();
  const outbox = new AggregationOutbox(port2, "superbet", {
    onResync: () => onResync(outbox),
    onError: (error) => errors.push(error),
  });
  const attach = (extra) =>
    aggregator.postMessage({
      type: "attach",
      generation: 1,
      options: options(extra),
    });
  return { aggregator, outbox, attach, errors };
}

async function batch(port) {
  const [message] = await once(port, "message");
  return { message, ...decode(message.buffer) };
}

const ack = (port, message) =>
  port.postMessage(
    {
      type: "ack",
      generation: message.generation,
      sequence: message.sequence,
      buffer: message.buffer,
    },
    [message.buffer],
  );

// Resolves with null when no message arrives within the delay.
async function quiet(port, ms = 30) {
  return Promise.race([
    once(port, "message").then(([message]) => message),
    tick(ms).then(() => null),
  ]);
}

const seed = (outbox) => {
  outbox.setEvent(identity(7));
  outbox.setLive(7, live());
  outbox.setLine(7, key, 1.8, 2.1, true, true);
};

test("nothing is recorded before attach; attach re-emits state behind a reset", async (t) => {
  const { aggregator, outbox, attach } = connect(seed);
  t.after(() => aggregator.close());
  assert.equal(outbox.setEvent(identity(7)), false);
  assert.equal(outbox.active, false);
  attach();
  const { message, header, calls } = await batch(aggregator);
  assert.equal(message.sequence, 1);
  assert.equal(header.provider, "superbet");
  assert.deepEqual(
    calls.map(([name]) => name),
    ["reset", "identity", "live", "define", "value"],
  );
  assert.deepEqual(calls.at(-1), ["value", 0, 1.8, 2.1, 3]);
});

test("only one batch is in flight and changes coalesce to the latest value", async (t) => {
  const { aggregator, outbox, attach } = connect(seed);
  t.after(() => aggregator.close());
  attach();
  const first = await batch(aggregator);
  for (let step = 81; step <= 90; step++)
    outbox.setLine(7, key, step / 50, 2.1, true, true);
  assert.equal(await quiet(aggregator), null);
  ack(aggregator, first.message);
  const second = await batch(aggregator);
  assert.equal(second.message.sequence, 2);
  assert.deepEqual(second.calls, [["value", 0, 1.8, 2.1, 3]]);
  assert.equal(outbox.getStats().coalescedValues, 9);
  // An unchanged value is not marked again.
  ack(aggregator, second.message);
  outbox.setLine(7, key, 1.8, 2.1, true, true);
  assert.equal(await quiet(aggregator), null);
});

test("a score change separates older prices from newer ones", async (t) => {
  const { aggregator, outbox, attach } = connect(seed);
  t.after(() => aggregator.close());
  attach();
  ack(aggregator, (await batch(aggregator)).message);
  await tick();
  outbox.setLine(7, key, 1.7, 2.2, true, true);
  outbox.setLive(7, live({ homeScore: 1 }));
  outbox.setLine(7, key, 2.6, 1.5, true, true);
  const { header, calls } = await batch(aggregator);
  assert.equal(header.segments, 2);
  assert.deepEqual(calls, [
    ["value", 0, 1.7, 2.2, 3],
    ["live", 0, 5 | 8, 1, 0, 600],
    ["value", 0, 2.6, 1.5, 3],
  ]);
});

test("clock-only changes do not split the coalescing window", async (t) => {
  const { aggregator, outbox, attach } = connect(seed);
  t.after(() => aggregator.close());
  attach();
  ack(aggregator, (await batch(aggregator)).message);
  await tick();
  outbox.setLine(7, key, 1.7, 2.2, true, true);
  outbox.setLive(7, live({ clockSeconds: 601 }));
  outbox.setLine(7, key, 1.75, 2.15, true, true);
  const { header, calls } = await batch(aggregator);
  assert.equal(header.segments, 1);
  assert.deepEqual(calls, [
    ["live", 0, 13, 0, 0, 601],
    ["value", 0, 1.75, 2.15, 3],
  ]);
});

test("released lines drop pending values and their handles are reused", async (t) => {
  const { aggregator, outbox, attach } = connect(seed);
  t.after(() => aggregator.close());
  attach();
  ack(aggregator, (await batch(aggregator)).message);
  await tick();
  outbox.setLine(7, key, 1.7, 2.2, true, true);
  outbox.releaseLine(7, key);
  outbox.setLine(7, other, 1.95, 1.95, false, true);
  const { calls } = await batch(aggregator);
  assert.deepEqual(calls, [
    ["line-release", 0],
    ["define", 0, 0, other],
    ["value", 0, 1.95, 1.95, 2],
  ]);
});

test("event invalidation releases lines first and is sent without waiting for the window", async (t) => {
  const { aggregator, outbox, attach } = connect(seed);
  t.after(() => aggregator.close());
  attach({ batchWindowMs: 1_000 });
  ack(aggregator, (await batch(aggregator)).message);
  await tick();
  outbox.setLine(7, other, 3, 1.4, true, true);
  outbox.releaseEvent(7);
  const started = Date.now();
  const { calls } = await batch(aggregator);
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(calls, [
    ["define", 1, 0, other],
    ["line-release", 0],
    ["line-release", 1],
    ["event-release", 0],
  ]);
  assert.deepEqual(
    { events: outbox.getStats().events, lines: outbox.getStats().lines },
    { events: 0, lines: 0 },
  );
});

test("resync replaces the in-flight batch with a fresh reset", async (t) => {
  let resyncs = 0;
  const { aggregator, outbox, attach } = connect((target) => {
    resyncs++;
    seed(target);
  });
  t.after(() => aggregator.close());
  attach();
  const first = await batch(aggregator);
  aggregator.postMessage({
    type: "resync",
    generation: 1,
    sequence: first.message.sequence,
  });
  const second = await batch(aggregator);
  assert.equal(second.message.sequence, 2);
  assert.equal(resyncs, 2);
  assert.deepEqual(
    second.calls.map(([name]) => name),
    ["reset", "identity", "live", "define", "value"],
  );
});

test("an unacknowledged backlog beyond the limit restarts from projection state", async (t) => {
  let resyncs = 0;
  const { aggregator, outbox, attach } = connect((target) => {
    resyncs++;
    seed(target);
  });
  t.after(() => aggregator.close());
  attach({
    maxEvents: 1,
    maxLines: 1,
    maxBatchBytes: 2 * fullStateBytes(1, 1),
  });
  const first = await batch(aggregator);
  for (let second = 0; second < 200; second++)
    outbox.setLive(7, live({ clockSeconds: 700 + second }));
  assert.equal(resyncs, 2);
  ack(aggregator, first.message);
  const { calls } = await batch(aggregator);
  assert.equal(calls[0][0], "reset");
  assert.equal(calls.filter(([name]) => name === "reset").length, 1);
  assert.deepEqual(calls.at(-1), ["value", 0, 1.8, 2.1, 3]);
});

test("invalid adapter input is counted and never written", async (t) => {
  const { aggregator, outbox, attach } = connect();
  t.after(() => aggregator.close());
  attach();
  ack(aggregator, (await batch(aggregator)).message);
  assert.equal(outbox.setEvent(identity(0)), false);
  assert.equal(outbox.setLive(99, live()), false);
  assert.equal(outbox.setLine(99, key, 2, 2, true, true), false);
  outbox.setEvent(identity(7));
  assert.equal(outbox.setLine(7, 0, 2, 2, true, true), false);
  // Unusable prices become NaN and clear the usable flag.
  outbox.setLine(7, key, 0, 1, true, true);
  assert.equal(outbox.getStats().rejected, 4);
  const { calls } = await batch(aggregator);
  assert.deepEqual(calls.at(-1), ["value", 0, NaN, NaN, 0]);
});

test("unexpected control messages are reported and ignored", async (t) => {
  const { aggregator, attach, errors } = connect();
  t.after(() => aggregator.close());
  aggregator.postMessage({ type: "ack", generation: 1, sequence: 1 });
  aggregator.postMessage({
    type: "attach",
    generation: 1,
    options: options({ maxBatchBytes: 10 }),
  });
  attach();
  const { message } = await batch(aggregator);
  aggregator.postMessage({
    type: "ack",
    generation: 1,
    sequence: 5,
    buffer: new ArrayBuffer(64),
  });
  attach();
  await tick(20);
  assert.deepEqual(errors, [
    "Invalid aggregation control message.",
    "Invalid aggregation control message.",
    "Unexpected aggregation ack.",
    "Aggregation port is already attached.",
  ]);
  assert.equal(message.sequence, 1);
});

test("closing the aggregator side deactivates the outbox", async () => {
  const { aggregator, outbox, attach } = connect(seed);
  attach();
  await batch(aggregator);
  aggregator.close();
  await tick(20);
  assert.equal(outbox.active, false);
  assert.equal(outbox.setLine(7, key, 2, 2, true, true), false);
});
