import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { FootballAggregationAdapter } from "../dist/aggregation/adapter/football.js";
import { AggregationOutbox } from "../dist/aggregation/adapter/outbox.js";
import { aggregationConfig } from "../dist/aggregation/config.js";
import { LearnedTables } from "../dist/aggregation/matching/learning.js";
import { AggregationEngine } from "../dist/aggregation/processing/engine.js";
import { AggregationSession } from "../dist/aggregation/processing/session.js";
import { fullStateBytes, lineKey } from "../dist/aggregation/protocol/wire.js";
import { identity, tick, until } from "./helpers/aggregation.mjs";

// Exercise actual adapters, binary batches, ACKs, sessions and detection together.
test("a disconnect and replacement baseline retain the match and opportunity across the real wire", async (t) => {
  const options = {
    ...aggregationConfig, maxEvents: 4, maxLines: 8,
    maxBatchBytes: 2 * fullStateBytes(4, 8), batchWindowMs: 1, scoreSettleMs: 1,
  };
  const records = [];
  const engine = new AggregationEngine(options, new LearnedTables(null, assert.fail), {
    onRecord: (record) => records.push(record),
  });
  const opportunities = () => records.filter((record) => record.type === "opportunity");
  function side(provider, id, priceA, priceB) {
    const { port1, port2 } = new MessageChannel();
    const snapshot = {
      event: { id }, synchronized: true,
      lines: [{ key: "old", total: 2.5, priceA, priceB, usableA: true, usableB: true }],
    };
    const codec = {
      provider,
      identity: (event) => identity(event.id),
      live: () => ({ live: true, suspended: false, homeScore: 1, awayScore: 0, clockSeconds: 1_200, clockRunning: true }),
      marketType: () => provider === "superbet" ? 200734 : 13,
      lineKey: (line, row) => lineKey(row.code, line.total * 4),
      quote: (line, target) => Object.assign(target, line),
    };
    let adapter;
    const outbox = new AggregationOutbox(port2, provider, {
      onResync: () => adapter.resync(), onError: assert.fail,
    });
    adapter = new FootballAggregationAdapter(outbox, codec, () => [snapshot]);
    const session = new AggregationSession(provider, port1, 1, options, {
      onError: (_, error) => assert.fail(error),
    }, engine.sink(provider));
    t.after(() => { outbox.close(); session.close(); });
    session.start();
    const send = async (action) => {
      const before = session.getStats().batches;
      action();
      await until(() => session.getStats().batches > before && !outbox.getStats().inFlight);
    };
    return { snapshot, adapter, outbox, session, send };
  }
  const sb = side("superbet", 11, 2.1, 1.8);
  const bt = side("betano", 22, 1.75, 2.15);
  await until(() => sb.session.getStats().lines === 1 && bt.session.getStats().lines === 1);
  await tick(5);
  engine.sweep(Date.now());
  const opened = opportunities().at(-1);
  assert.equal(opened.kind, "open");
  assert.equal(engine.takeMatchedEvents().length, 1);

  await sb.send(() => {
    sb.snapshot.synchronized = false;
    sb.adapter.update({ kind: "invalidate", eventId: 11, upserts: [], removed: [] });
  });
  assert.equal(opportunities().at(-1).kind, "pause");
  assert.equal(sb.session.getStats().events, 1);
  assert.equal(sb.session.getStats().lines, 1);
  assert.equal(engine.takeMatchedEvents(), null);

  await bt.send(() => bt.adapter.update({
    kind: "update", eventId: 22, removed: [],
    upserts: [{ ...bt.snapshot.lines[0], priceB: 2.2 }],
  }));
  assert.equal(opportunities().at(-1).kind, "pause");
  await sb.send(() => {
    sb.snapshot.synchronized = true;
    sb.snapshot.lines[0] = { ...sb.snapshot.lines[0], key: "replacement", priceA: 2.2 };
    sb.adapter.install(sb.snapshot);
  });
  const resumed = opportunities().at(-1);
  assert.deepEqual([resumed.kind, resumed.id, resumed.openedAt], ["resume", opened.id, opened.openedAt]);
  assert.deepEqual(resumed.legs.map((leg) => leg.price), [2.2, 2.2]);
  assert.equal(engine.takeMatchedEvents(), null);
  assert.deepEqual(opportunities().map((report) => report.kind), ["open", "pause", "resume"]);

  await sb.send(() => {
    sb.snapshot.lines = [];
    sb.adapter.install(sb.snapshot);
  });
  assert.deepEqual([opportunities().at(-1).kind, opportunities().at(-1).reason], ["close", "unlinked"]);
  assert.equal(sb.session.getStats().events, 1);
  assert.equal(sb.session.getStats().lines, 0);
  await sb.send(() => sb.adapter.update({ kind: "remove", eventId: 11, upserts: [], removed: [] }));
  assert.deepEqual(engine.takeMatchedEvents(), []);
});
