import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { FootballAggregationAdapter } from "../dist/aggregation/adapter/football.js";
import { AggregationOutbox } from "../dist/aggregation/adapter/outbox.js";
import { fullStateBytes, lineKey, liveFlags } from "../dist/aggregation/protocol/wire.js";
import { betanoFootballCodec } from "../dist/providers/betano/processing/aggregation.js";
import { superbetFootballCodec } from "../dist/providers/superbet/processing/aggregation.js";
import { decode } from "./helpers/aggregation.mjs";

const running = liveFlags.live | liveFlags.score | liveFlags.clock | liveFlags.running;

const superbetEvent = (extra = {}) => ({
  id: 11,
  betradarId: 555,
  home: { id: "1", name: "Home" },
  away: { id: "2", name: "Away" },
  competitionId: 106,
  categoryId: 45,
  startsAt: "2026-10-24T14:00:00.000Z",
  phase: "live",
  status: "STARTED",
  offerStatus: 1,
  homeScore: "1",
  awayScore: "0",
  period: "2H",
  minute: "48",
  stoppageTime: null,
  ...extra,
});

const superbetLine = (marketId, total, uuid, extra = {}, prices = [1.8, 2.1]) => ({
  key: `${marketId}:2:${uuid}`,
  marketId,
  lineId: uuid,
  offerStateId: 2,
  total,
  handicap: null,
  fromMinute: null,
  toMinute: null,
  firstMinutes: null,
  selections: [
    { id: `${uuid}-u`, outcomeId: 1, role: "under", price: prices[0], status: 1, display: true, handicap: null },
    { id: `${uuid}-o`, outcomeId: 2, role: "over", price: prices[1], status: 1, display: true, handicap: null },
  ],
  ...extra,
});

const betanoEvent = (extra = {}) => ({
  id: 22,
  betradarId: 555,
  home: { id: "1", name: "Home" },
  away: { id: "2", name: "Away" },
  competitionId: 7,
  categoryId: 8,
  startsAt: "2026-10-24T14:00:00.000Z",
  phase: "live",
  isSuspended: false,
  homeScore: "1",
  awayScore: "0",
  clockSeconds: 2_880.6,
  clockStopped: false,
  ...extra,
});

const betanoRedCard = (extra = {}) => ({
  key: "900:binary",
  marketId: 900,
  marketTypeId: 51,
  total: null,
  handicap: null,
  interval: null,
  scoreContext: null,
  isSuspended: false,
  selections: [
    { id: "1", outcomeId: 192, role: "yes", price: 3.5, isSuspended: false, handicap: null },
    { id: "2", outcomeId: 193, role: "no", price: 1.3, isSuspended: false, handicap: null },
  ],
  ...extra,
});

async function connect(codec, snapshots, enabledConditions = ["D", "T"]) {
  const { port1: aggregator, port2 } = new MessageChannel();
  let adapter;
  const outbox = new AggregationOutbox(port2, codec.provider, {
    onResync: () => adapter.resync(),
  });
  adapter = new FootballAggregationAdapter(outbox, codec, () => snapshots);
  aggregator.postMessage({
    type: "attach",
    generation: 1,
    options: {
      batchWindowMs: 1,
      maxEvents: 8,
      maxLines: 32,
      maxBatchBytes: 2 * fullStateBytes(8, 32),
      enabledConditions,
    },
  });
  const next = async () => {
    const [message] = await once(aggregator, "message", {
      signal: AbortSignal.timeout(2_000),
    });
    // Decode before the acknowledgement transfers the buffer back.
    const { calls } = decode(message.buffer);
    aggregator.postMessage(
      { type: "ack", generation: 1, sequence: message.sequence, buffer: message.buffer },
      [message.buffer],
    );
    return calls;
  };
  return { aggregator, outbox, adapter, next };
}

test("a Superbet snapshot becomes identity, live state, and canonical lines", async (t) => {
  const { aggregator, adapter, next } = await connect(superbetFootballCodec, [
    {
      event: superbetEvent(),
      lines: [
        superbetLine(200734, 2.5, "goals"),
        superbetLine(999_999, 2.5, "unknown"),
        superbetLine(200734, 1.5, "first-ten", { firstMinutes: 10 }),
      ],
    },
  ]);
  t.after(() => aggregator.close());
  const calls = await next();
  assert.deepEqual(calls.map(([name]) => name), ["reset", "identity", "live", "define", "value"]);
  const [, , identity] = calls[1];
  assert.deepEqual(
    [identity.eventId, identity.betradarId, identity.startsAt, identity.competitionId],
    [11, 555, Date.parse("2026-10-24T14:00:00Z"), 106],
  );
  assert.deepEqual(calls[2], ["live", 0, running, 1, 0, 2_880]);
  assert.deepEqual(calls[3], ["define", 0, 0, lineKey(1, 10)]);
  // Role A is over, regardless of the vendor's selection order.
  assert.deepEqual(calls[4], ["value", 0, 2.1, 1.8, 3]);
  assert.deepEqual(adapter.getStats(), { events: 1, lines: 1, rejectedEvents: 0, ambiguousLines: 0 });
});

test("Superbet status, offer state, and period decide usability and the clock", async (t) => {
  const line = superbetLine(200734, 2.5, "goals");
  line.selections[1].status = 2;
  const { aggregator, next } = await connect(superbetFootballCodec, [
    {
      event: superbetEvent({ offerStatus: 2, period: "HT", minute: "45" }),
      lines: [line],
    },
  ]);
  t.after(() => aggregator.close());
  const calls = await next();
  // Half time is a stopped clock at 45:00.
  assert.deepEqual(calls[2], [
    "live", 0, liveFlags.live | liveFlags.suspended | liveFlags.score | liveFlags.clock, 1, 0, 2_700,
  ]);
  // The price is kept for reference; only the usable bit of the status-2 side drops.
  assert.deepEqual(calls.at(-1), ["value", 0, 2.1, 1.8, 2]);
});

test("a Betano yes/no line and a Superbet total at the threshold share one key", async (t) => {
  const betano = await connect(betanoFootballCodec, [
    { event: betanoEvent(), lines: [betanoRedCard()] },
  ]);
  const superbet = await connect(superbetFootballCodec, [
    {
      event: superbetEvent(),
      lines: [
        superbetLine(233942, 0.5, "red-0.5"),
        superbetLine(233942, 1.5, "red-1.5"),
      ],
    },
  ]);
  t.after(() => {
    betano.aggregator.close();
    superbet.aggregator.close();
  });
  const left = (await betano.next()).filter(([name]) => name === "define");
  const right = (await superbet.next()).filter(([name]) => name === "define");
  assert.equal(left.length, 1);
  assert.equal(right.length, 1);
  assert.equal(left[0][3], right[0][3]);
});

test("disabled conditions keep their lines off the wire", async (t) => {
  const { aggregator, next } = await connect(
    betanoFootballCodec,
    [{ event: betanoEvent(), lines: [betanoRedCard()] }],
    ["D"],
  );
  t.after(() => aggregator.close());
  assert.equal((await next()).some(([name]) => name === "define"), false);
});

test("Betano suspensions, omitted clock flags, and score-based lines are respected", async (t) => {
  const { aggregator, next } = await connect(betanoFootballCodec, [
    {
      event: betanoEvent({ clockStopped: null, isSuspended: true }),
      lines: [
        betanoRedCard({ isSuspended: true }),
        betanoRedCard({ key: "901:0", marketId: 901, scoreContext: { home: 1, away: 0 } }),
      ],
    },
  ]);
  t.after(() => aggregator.close());
  const calls = await next();
  // Betano omits clockStopped while the clock runs.
  assert.deepEqual(calls[2], ["live", 0, running | liveFlags.suspended, 1, 0, 2_880]);
  assert.equal(calls.filter(([name]) => name === "define").length, 1);
  assert.deepEqual(calls.at(-1), ["value", 0, 3.5, 1.3, 0]);
});

test("two vendor lines claiming one canonical line are both withheld", async (t) => {
  const { aggregator, adapter, next } = await connect(superbetFootballCodec, [
    { event: superbetEvent(), lines: [superbetLine(200734, 2.5, "first")] },
  ]);
  t.after(() => aggregator.close());
  await next();
  adapter.update({
    kind: "update",
    eventId: 11,
    upserts: [superbetLine(200734, 2.5, "second")],
    removed: [],
  });
  assert.deepEqual(await next(), [["line-release", 0]]);
  assert.equal(adapter.getStats().ambiguousLines, 1);
  // The surviving vendor line stays withheld until a new baseline.
  adapter.update({
    kind: "update",
    eventId: 11,
    upserts: [superbetLine(200734, 2.5, "first", {}, [1.7, 2.2])],
    removed: [],
  });
  assert.equal(adapter.getStats().lines, 0);
});

test("updates, removals, identity changes, and invalidation reach the outbox in order", async (t) => {
  const { aggregator, adapter, next } = await connect(superbetFootballCodec, [
    { event: superbetEvent(), lines: [superbetLine(200734, 2.5, "goals")] },
  ]);
  t.after(() => aggregator.close());
  await next();
  adapter.update({
    kind: "update",
    eventId: 11,
    event: superbetEvent({ homeScore: "2" }),
    upserts: [superbetLine(200734, 3.5, "goals-3.5")],
    removed: ["200734:2:goals"],
  });
  assert.deepEqual(
    (await next()).map(([name, ...rest]) => (name === "live" ? [name, rest[2]] : [name])),
    [["live", 2], ["line-release"], ["define"], ["value"]],
  );
  adapter.update({
    kind: "update",
    eventId: 11,
    event: superbetEvent({ homeScore: "2", betradarId: 556 }),
    upserts: [],
    removed: [],
  });
  assert.equal((await next())[0][2].betradarId, 556);
  adapter.update({ kind: "invalidate", eventId: 11, upserts: [], removed: [] });
  assert.deepEqual(
    (await next()).map(([name]) => name),
    ["line-release", "event-release"],
  );
  assert.equal(adapter.getStats().events, 0);
});
