import assert from "node:assert/strict";
import test from "node:test";
import { aggregationConfig } from "../dist/aggregation/config.js";
import { LearnedTables } from "../dist/aggregation/matching/learning.js";
import { AggregationEngine } from "../dist/aggregation/processing/engine.js";
import { lineKey, liveFlags, valueFlags } from "../dist/aggregation/protocol/wire.js";
import { identity } from "./helpers/aggregation.mjs";

const goals = lineKey(1, 10);
const usable = valueFlags.usableA | valueFlags.usableB;
const running = liveFlags.live | liveFlags.score | liveFlags.clock | liveFlags.running;
const start = 1_792_850_400_000;

// Drives the engine through its provider sinks exactly as validated batches would.
function setup(extra = {}) {
  const options = { ...aggregationConfig, maxEvents: 16, maxLines: 64, ...extra };
  const records = [];
  const tables = new LearnedTables(null, (error) => assert.fail(error));
  const engine = new AggregationEngine(options, tables, {
    onRecord: (report) => records.push(report),
  });
  const sinks = { superbet: engine.sink("superbet"), betano: engine.sink("betano") };
  const clock = { now: start + 20 * 60_000 };
  const batch = (provider, write, sentAt = clock.now) => {
    sinks[provider].begin(clock.now);
    write(sinks[provider]);
    sinks[provider].commit(sentAt);
  };
  const advance = (ms) => {
    clock.now += ms;
    engine.sweep(clock.now);
  };
  const opportunities = () => records.filter((r) => r.type === "opportunity");
  const pairs = () => records.filter((r) => r.kind === "pair");
  return { engine, tables, records, batch, advance, clock, opportunities, pairs, options };
}

const superbetMatch = (extra = {}) =>
  identity(11, {
    betradarId: 555,
    startsAt: start,
    home: "FC Steaua București",
    away: "Rapid București",
    ...extra,
  });
const betanoMatch = (extra = {}) =>
  identity(22, {
    betradarId: 555,
    startsAt: start + 7 * 60_000,
    home: "Steaua Bucureşti",
    away: "Rapid Bucureşti",
    ...extra,
  });

// Both books live at 1-0 around minute 20, each with the 2.5 goals line.
function pairUp(context, { superbet = {}, betano = {}, superbetLive, betanoLive } = {}) {
  const { batch, clock } = context;
  batch("superbet", (sink) => {
    sink.eventIdentity(0, superbetMatch(superbet));
    sink.eventLive(0, ...(superbetLive ?? [running, 1, 0, 1_200]));
    sink.lineDefine(0, 0, goals);
    sink.value(0, 2.1, 1.8, usable);
  });
  batch("betano", (sink) => {
    sink.eventIdentity(0, betanoMatch(betano));
    sink.eventLive(0, ...(betanoLive ?? [running, 1, 0, 1_230]));
    sink.lineDefine(0, 0, goals);
    sink.value(0, 1.75, 2.15, usable);
  });
  return clock;
}

test("an ID pair with agreeing names, start, clock, and score is confirmed and linked", () => {
  const context = setup();
  pairUp(context);
  const [report] = context.pairs();
  assert.equal(report.state, "confirmed");
  assert.deepEqual(report.reasons, []);
  assert.equal(report.similarity, 1);
  const { matching } = context.engine.getStats();
  assert.equal(matching.confirmed, 1);
  assert.deepEqual(matching.unmatched.superbet, { withId: 0, withoutId: 0 });
});

test("an arbitrage opens only after the score settles and reports legs and stakes", () => {
  const context = setup();
  pairUp(context);
  // The Betano score arrived while the pair existed, so comparison waits for the settle period.
  assert.equal(context.opportunities().length, 0);
  context.advance(context.options.scoreSettleMs + 1);
  const [open] = context.opportunities();
  assert.equal(open.kind, "open");
  const sum = 1 / 2.1 + 1 / 2.15;
  assert.equal(open.marginBps, Math.round((1 / sum - 1) * 1_000_000) / 100);
  assert.deepEqual(
    open.legs.map((leg) => [leg.provider, leg.outcome, leg.label, leg.price]),
    [
      ["superbet", "A", "over", 2.1],
      ["betano", "B", "under", 2.15],
    ],
  );
  assert.ok(Math.abs(open.legs[0].stakeShare + open.legs[1].stakeShare - 1) < 1e-3);
  assert.equal(open.line, 2.5);
  assert.equal(open.concept, "Total goluri");
  assert.equal(open.score, "1-0");
  assert.equal(open.suspicious, false);
  // Both prices arrived before the settle period, so each leg is at least that old.
  assert.ok(open.legs.every((leg) => leg.ageMs >= context.options.scoreSettleMs));
  // 1.95 would still leave about 1.1%; 1.85 restores a normal book margin and ends it.
  context.batch("betano", (sink) => sink.value(0, 1.75, 1.95, usable));
  assert.equal(context.opportunities().at(-1).kind, "update");
  context.batch("betano", (sink) => sink.value(0, 1.75, 1.85, usable));
  const close = context.opportunities().at(-1);
  assert.deepEqual([close.kind, close.reason, close.id], ["close", "margin", open.id]);
});

test("a goal on one book blocks the pair until both agree and settle", () => {
  const context = setup();
  pairUp(context);
  context.advance(context.options.scoreSettleMs + 1);
  assert.equal(context.opportunities().length, 1);
  context.batch("superbet", (sink) => sink.eventLive(0, running, 2, 0, 1_300));
  assert.deepEqual(
    [context.opportunities().at(-1).kind, context.opportunities().at(-1).reason],
    ["close", "score"],
  );
  context.batch("betano", (sink) => sink.eventLive(0, running, 2, 0, 1_310));
  context.advance(1_000);
  assert.equal(context.opportunities().at(-1).kind, "close");
  context.advance(context.options.scoreSettleMs);
  assert.equal(context.opportunities().at(-1).kind, "open");
});

test("a score disagreement that persists marks the pair suspect and unlinks it", () => {
  const context = setup();
  pairUp(context, { betanoLive: [running, 0, 0, 1_230] });
  context.advance(context.options.scoreMismatchMs + 1);
  const report = context.pairs().at(-1);
  assert.equal(report.state, "suspect");
  assert.deepEqual(report.reasons, ["score"]);
  context.batch("betano", (sink) => sink.eventLive(0, running, 1, 0, 1_300));
  assert.equal(context.pairs().at(-1).state, "confirmed");
});

test("youth, women, and reserve squads never pair with the senior team", () => {
  for (const [home, marker] of [
    ["Steaua București U21", "u21"],
    ["Steaua București (F)", "w"],
    ["Steaua București II", "ii"],
  ]) {
    const context = setup();
    pairUp(context, { betano: { home } });
    const report = context.pairs().at(-1);
    assert.equal(report.state, "suspect", marker);
    assert.ok(report.reasons.includes("markers"), marker);
    context.advance(context.options.scoreSettleMs + 1);
    assert.equal(context.opportunities().length, 0, marker);
  }
});

test("teams swapped between books are not compared", () => {
  const context = setup();
  pairUp(context, {
    betano: { home: "Rapid Bucureşti", away: "Steaua Bucureşti" },
  });
  assert.deepEqual(context.pairs().at(-1).reasons, ["orientation"]);
});

test("a start time beyond tolerance or a different match clock makes the pair suspect", () => {
  const late = setup();
  pairUp(late, { betano: { startsAt: start + 3 * 60 * 60_000 } });
  assert.deepEqual(late.pairs().at(-1).reasons, ["start"]);
  const clock = setup();
  pairUp(clock, { betanoLive: [running, 1, 0, 3_600] });
  assert.deepEqual(clock.pairs().at(-1).reasons, ["clock"]);
});

test("an ID with unrelated names needs start and clock corroboration", () => {
  const context = setup();
  pairUp(context, { betano: { home: "Dinamo București", away: "CFR Cluj" } });
  assert.deepEqual(context.pairs().at(-1).state, "confirmed");
  // Without a clock on one side the names alone cannot vouch for the ID.
  const unclocked = setup();
  pairUp(unclocked, {
    betano: { home: "Dinamo București", away: "CFR Cluj" },
    betanoLive: [liveFlags.live | liveFlags.score, 1, 0, 0],
  });
  assert.deepEqual(unclocked.pairs().at(-1).reasons, ["unverified"]);
});

test("a duplicated Betradar ID blocks every event that carries it", () => {
  const context = setup();
  pairUp(context);
  context.batch("superbet", (sink) =>
    sink.eventIdentity(1, superbetMatch({ eventId: 12 })),
  );
  const { matching } = context.engine.getStats();
  assert.equal(matching.confirmed, 0);
  assert.equal(matching.conflicts, 1);
  assert.equal(context.pairs().at(-1).state, "removed");
  context.batch("superbet", (sink) => sink.eventRelease(1));
  assert.equal(context.engine.getStats().matching.confirmed, 1);
});

test("released events, lines, and provider resets close opportunities", () => {
  const context = setup();
  pairUp(context);
  context.advance(context.options.scoreSettleMs + 1);
  context.batch("betano", (sink) => sink.lineRelease(0));
  assert.deepEqual(
    [context.opportunities().at(-1).kind, context.opportunities().at(-1).reason],
    ["close", "unlinked"],
  );
  context.batch("betano", (sink) => {
    sink.lineDefine(0, 0, goals);
    sink.value(0, 1.75, 2.15, usable);
  });
  assert.equal(context.opportunities().at(-1).kind, "open");
  context.batch("superbet", (sink) => sink.reset());
  assert.equal(context.opportunities().at(-1).reason, "unlinked");
  assert.equal(context.engine.getStats().matching.confirmed, 0);
});

test("unusable sides, suspensions, and late batches are never compared", () => {
  const context = setup();
  pairUp(context);
  context.advance(context.options.scoreSettleMs + 1);
  context.batch("betano", (sink) => sink.value(0, 1.75, 2.15, valueFlags.usableA));
  assert.equal(context.opportunities().at(-1).reason, "margin");
  context.batch("betano", (sink) => sink.value(0, 1.75, 2.15, usable));
  assert.equal(context.opportunities().at(-1).kind, "open");
  context.batch("superbet", (sink) =>
    sink.eventLive(0, running | liveFlags.suspended, 1, 0, 1_200),
  );
  assert.equal(context.opportunities().at(-1).reason, "suspended");
  context.batch("superbet", (sink) => sink.eventLive(0, running, 1, 0, 1_200));
  assert.equal(context.opportunities().at(-1).kind, "open");
  context.batch(
    "betano",
    () => {},
    context.clock.now - context.options.maxLagMs - 1,
  );
  assert.equal(context.opportunities().at(-1).reason, "lag");
});

test("an implausible margin is reported as suspicious", () => {
  const context = setup();
  pairUp(context);
  context.batch("betano", (sink) => sink.value(0, 1.2, 4, usable));
  context.advance(context.options.scoreSettleMs + 1);
  const open = context.opportunities().at(-1);
  assert.equal(open.suspicious, true);
  assert.ok(open.marginBps > context.options.suspiciousMarginBps);
});

test("events without an ID are only observed by name, never compared", () => {
  const context = setup();
  pairUp(context, { superbet: { betradarId: 0 }, betano: { betradarId: 0 } });
  context.advance(context.options.scoreSettleMs + 1);
  assert.equal(context.pairs().length, 0);
  context.engine.scan(context.clock.now);
  const observed = context.records.filter((r) => r.kind === "observed");
  assert.equal(observed.length, 1);
  assert.equal(observed[0].similarity, 1);
  assert.equal(context.opportunities().length, 0);
  // Seen once, reported once.
  context.engine.scan(context.clock.now);
  assert.equal(context.records.filter((r) => r.kind === "observed").length, 1);
});

test("name-only candidates respect squad markers, IDs, and uniqueness", () => {
  const youth = setup();
  pairUp(youth, {
    superbet: { betradarId: 0, home: "Atenas U21", away: "Wanderers" },
    betano: { betradarId: 0, home: "Atenas LDD", away: "Wanderers" },
  });
  youth.engine.scan(youth.clock.now);
  assert.equal(youth.engine.getStats().matching.observed, 0);
  const ids = setup();
  pairUp(ids, { betano: { betradarId: 777 } });
  ids.engine.scan(ids.clock.now);
  assert.equal(ids.engine.getStats().matching.observed, 0);
  const twice = setup();
  pairUp(twice, { superbet: { betradarId: 0 }, betano: { betradarId: 0 } });
  twice.batch("betano", (sink) => {
    sink.eventIdentity(1, betanoMatch({ eventId: 23, betradarId: 0 }));
    sink.eventLive(1, running, 1, 0, 1_230);
  });
  twice.engine.scan(twice.clock.now);
  assert.equal(twice.engine.getStats().matching.observed, 0);
});

test("aliases and competitions are learned only after a pair stays confirmed", () => {
  const context = setup();
  pairUp(context, {
    superbet: { home: "FCSB", competitionId: 7 },
    betano: { competitionId: 70 },
  });
  assert.deepEqual(context.tables.sizes, { aliases: 0, competitions: 0 });
  context.advance(5 * 60_000);
  assert.deepEqual(context.tables.sizes, { aliases: 1, competitions: 1 });
  assert.equal(context.tables.competition(7), 70);
});

test("a duplicate line key inside one event is a protocol error", () => {
  const context = setup();
  pairUp(context);
  assert.throws(
    () => context.batch("superbet", (sink) => sink.lineDefine(1, 0, goals)),
    /already defined/,
  );
});
