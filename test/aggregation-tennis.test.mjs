import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MessageChannel } from "node:worker_threads";
import { once } from "node:events";
import { AggregationController } from "../dist/aggregation/controller.js";
import { ProjectionAggregationAdapter } from "../dist/aggregation/adapter/projection.js";
import { AggregationOutbox } from "../dist/aggregation/adapter/outbox.js";
import {
  tennisLineKey,
  tennisPoint,
} from "../dist/aggregation/adapter/tennis.js";
import { aggregationConfig } from "../dist/aggregation/config.js";
import { tennisMarketMapping } from "../dist/aggregation/tennis-mapping.config.js";
import { validateTennisMapping } from "../dist/aggregation/tennis-mapping.js";
import { mappingIndex } from "../dist/aggregation/mapping.js";
import { LearnedTables } from "../dist/aggregation/matching/learning.js";
import {
  normalizeTennisParticipant,
  tennisNameSimilarity,
} from "../dist/aggregation/matching/tennis-names.js";
import { AggregationEngine } from "../dist/aggregation/processing/engine.js";
import { AggregationSession } from "../dist/aggregation/processing/session.js";
import {
  BatchWriter,
  readBatch,
  readHeader,
  fullStateBytes,
  lineKey,
  lineVariant,
  liveFlags,
} from "../dist/aggregation/protocol/wire.js";
import {
  isTennisContext,
  sameTennisContext,
  tennisContextAgrees,
} from "../dist/aggregation/protocol/tennis.js";
import { superbetTennisCodec } from "../dist/providers/superbet/processing/tennis-aggregation.js";
import { betanoTennisCodec } from "../dist/providers/betano/processing/tennis-aggregation.js";
import { projectPrematchTennis } from "../dist/providers/betano/processing/tennis-prematch.js";
import {
  tennisEvent,
  tennisLines,
} from "../dist/providers/superbet/processing/tennis-markets.js";
import { decode, identity, tick, until } from "./helpers/aggregation.mjs";

const flags = liveFlags.live | liveFlags.score;
const key = lineKey(1001, 90);
const now = 1792920000000;
const context = () => ({
  sets: [[3, 2]],
  points: [15, 30],
  server: 1,
  doubles: 0,
  currentSet: 1,
});
const match = (id) =>
  identity(id, {
    betradarId: 555,
    startsAt: now - 10000,
    home: "Daniil Medvedev",
    away: "Nikoloz Basilashvili",
  });

function setup() {
  const options = {
    ...aggregationConfig,
    maxEvents: 8,
    maxLines: 32,
    scoreSettleMs: 1,
    minMarginBps: 50,
  };
  const records = [];
  const engine = new AggregationEngine(
    options,
    new LearnedTables(null, assert.fail),
    { onRecord: (r) => records.push(r) },
    "tennis",
  );
  const sinks = {
    superbet: engine.sink("superbet"),
    betano: engine.sink("betano"),
  };
  let clock = now;
  const batch = (provider, write) => {
    sinks[provider].begin(clock);
    write(sinks[provider]);
    sinks[provider].commit(clock);
  };
  const advance = (ms = 2) => {
    clock += ms;
    engine.sweep(clock);
  };
  const pair = (changes = {}) => {
    for (const [provider, id] of [
      ["superbet", 11],
      ["betano", 22],
    ])
      batch(provider, (sink) => {
        sink.eventIdentity(0, match(id));
        sink.eventTennis(0, changes[provider] ?? context());
        sink.eventLive(0, flags, 0, 0, 0);
        sink.lineDefine(0, 0, key);
        sink.value(
          0,
          ...(provider === "superbet" ? [2.1, 1.8] : [1.75, 2.15]),
          3,
        );
      });
    advance();
  };
  return {
    engine,
    records,
    batch,
    advance,
    pair,
    opportunities: () => records.filter((r) => r.type === "opportunity"),
  };
}

function projectionEvent(provider, id = provider === "superbet" ? 11 : 22) {
  const common = {
    id,
    betradarId: 555,
    competitionId: 1,
    categoryId: 2,
    startsAt: new Date(now - 10000).toISOString(),
    phase: "live",
    player1: { id: "1", name: "Daniil Medvedev", playerIds: [1] },
    player2: { id: "2", name: "Nikoloz Basilashvili", playerIds: [2] },
    player1Sets: 0,
    player2Sets: 0,
    player1Points: "15",
    player2Points: "30",
    serving: "player1",
    sets: [{ number: 1, player1Games: 3, player2Games: 2 }],
  };
  return provider === "superbet"
    ? { ...common, status: "STARTED", offerStatus: 1 }
    : {
        ...common,
        isSuspended: false,
        isDoubles: null,
        currentSetNumber: 1,
        currentGameNumber: 6,
      };
}
function projectionLine(provider, extra = {}) {
  const base = {
    key: "vendor-old",
    marketId: provider === "superbet" ? 1002 : 777,
    marketTypeId: 1541,
    lineId: "uuid",
    offerStateId: 2,
    total: 22.5,
    handicap: null,
    setNumber: null,
    gameNumber: null,
    isSuspended: false,
  };
  const selection = (role, price) => ({
    id: role,
    outcomeId: 1,
    role,
    price,
    status: 1,
    display: true,
    isSuspended: false,
    handicap: 22.5,
  });
  return {
    ...base,
    selections:
      provider === "superbet"
        ? [selection("under", 1.8), selection("over", 2.1)]
        : [selection("over", 1.75), selection("under", 2.15)],
    ...extra,
  };
}

test("tennis mapping has 26 distinct concepts, 25 enabled rows, and rejects contradictory rows", () => {
  assert.equal(tennisMarketMapping.length, 26);
  assert.equal(
    tennisMarketMapping.filter((r) => r.enabled !== false).length,
    25,
  );
  assert.deepEqual(validateTennisMapping(), []);
  const index = mappingIndex("superbet", ["D", "P", "T"], tennisMarketMapping);
  assert.equal(index.size, 25);
  assert.equal(index.has(230641), false);
  for (const change of [
    (r) => (r.code = 1),
    (r) => (r.betano = 1551),
    (r) => (r.superbet = 999999),
    (r) => (r.conditions = ["H"]),
    (r) => (r.threshold = 0.5),
    (r) => (r.setNumber = 1),
  ]) {
    const rows = structuredClone(tennisMarketMapping);
    change(rows[0]);
    assert.ok(validateTennisMapping(rows).length);
  }
  const duplicates = [...tennisMarketMapping, tennisMarketMapping[0]];
  assert.ok(validateTennisMapping(duplicates).length >= 2);
});

test("independent vendor fixtures produce keys for every mapped concept and role A is semantic", () => {
  const sb = JSON.parse(
    readFileSync(
      new URL("./fixtures/superbet-tennis-markets.json", import.meta.url),
      "utf8",
    ),
  );
  const bt = JSON.parse(
    readFileSync(
      new URL("./fixtures/betano-tennis-markets.json", import.meta.url),
      "utf8",
    ),
  );
  for (const row of tennisMarketMapping) {
    const raw = sb.cases.find((c) => c.market.id === row.superbet);
    const event = tennisEvent({
      event_id: raw.eventId,
      fixture: { sport_id: 2, event_name: raw.eventName },
      inplay_stats_metadata: { status: raw.phase },
    });
    const line = [...tennisLines(raw.market, event).values()][0];
    const sample = bt.prematch.find((c) => c.market.typeId === row.betano);
    const result = projectPrematchTennis({
      ...sample.event,
      markets: [sample.market],
    });
    assert.ok(line, row.concept);
    assert.ok(result.lines.length, row.concept);
    // Fixture thresholds are independently offered; compare each key with its own exact threshold.
    const a = superbetTennisCodec.lineKey(line, row);
    assert.ok(a !== null, row.concept);
    assert.equal(lineVariant(a), line.setNumber ?? 0);
    for (const own of result.lines) {
      const b = betanoTennisCodec.lineKey(own, row);
      assert.ok(b !== null, row.concept);
    }
    const quote = {};
    superbetTennisCodec.quote(line, quote);
    const over = line.selections.find((s) =>
      ["over", "player1", "yes"].includes(s.role),
    );
    assert.equal(quote.priceA, over.price);
  }
});

test("canonical tennis keys require identical half lines, exact set, and fixed first-set restrictions", () => {
  const row = tennisMarketMapping[0],
    setRow = tennisMarketMapping.find((r) => r.code === 1005),
    firstSet = tennisMarketMapping.find((r) => r.code === 1007);
  assert.equal(tennisLineKey(row, "total", 22.5, null, null, null), key);
  for (const value of [22, 22.25, NaN, Infinity, null])
    assert.equal(tennisLineKey(row, "total", value, null, null, null), null);
  assert.notEqual(tennisLineKey(row, "total", 23.5, null, null, null), key);
  assert.notEqual(
    tennisLineKey(setRow, "total", 9.5, null, 1, null),
    tennisLineKey(setRow, "total", 9.5, null, 2, null),
  );
  for (const set of [0, 3, 4, 5])
    assert.equal(tennisLineKey(setRow, "total", 9.5, null, set, null), null);
  assert.equal(tennisLineKey(firstSet, "total", 4.5, null, 2, null), null);
  assert.equal(tennisLineKey(row, "total", 22.5, null, null, 1), null);
  const h = tennisMarketMapping[1];
  assert.notEqual(
    tennisLineKey(h, "handicap", null, 1.5, null, null),
    tennisLineKey(h, "handicap", null, -1.5, null, null),
  );
  assert.equal(
    superbetTennisCodec.lineKey(
      projectionLine("superbet", { setNumber: 1 }),
      row,
    ),
    null,
  );
});

test("tennis names support initials and doubles pairs while refusing unrelated or swapped participants", () => {
  const similarity = (a, b) =>
    tennisNameSimilarity(
      normalizeTennisParticipant(a),
      normalizeTennisParticipant(b),
    );
  assert.equal(similarity("D. Medvedev", "Daniil Medvedev"), 1);
  assert.equal(similarity("Leylah Fernandez", "Leylah Annie Fernandez"), 0.8);
  assert.equal(
    similarity(
      "A.Magadan/R.Pacheco Mendez",
      "Rodrigo Pacheco Mendez / Alan Magadan",
    ),
    1,
  );
  assert.equal(
    similarity(
      "A.Magadan/R.Pacheco Mendez",
      "Alan Magadan / Federico Zeballos",
    ),
    0,
  );
  assert.equal(similarity("A.Magadan/R.Pacheco Mendez", "Alan Magadan"), 0);
  assert.equal(similarity("A. B.", "Alan Brown"), 0);
  const f = setup();
  f.batch("superbet", (s) => s.eventIdentity(0, match(11)));
  f.batch("betano", (s) =>
    s.eventIdentity(0, {
      ...match(22),
      home: "Nikoloz Basilashvili",
      away: "Daniil Medvedev",
    }),
  );
  assert.equal(f.engine.getStats().matching.suspect, 1);
  assert.ok(f.records.at(-1).reasons.includes("orientation"));
});

test("tennis wire round trip preserves unknown scores and advantage, and rejects malformed contexts", () => {
  const c = context();
  c.points = [tennisPoint("A"), tennisPoint("AD")];
  assert.equal(c.points[0], c.points[1]);
  const writer = new BatchWriter();
  writer.eventIdentity(0, match(11));
  writer.eventTennis(0, c);
  assert.deepEqual(decode(writer.finish("superbet", 1, 1, now)).calls.at(-1), [
    "tennis",
    0,
    c,
  ]);
  assert.ok(tennisContextAgrees(c, structuredClone(c)));
  const unknown = context();
  unknown.points[0] = null;
  assert.equal(tennisContextAgrees(unknown, unknown), false);
  assert.equal(isTennisContext(null), false);
  assert.equal(isTennisContext({ ...c, sets: Array(6).fill([0, 0]) }), false);
  const invalid = new BatchWriter();
  invalid.eventTennis(0, context());
  const buffer = invalid.finish("superbet", 1, 1, now);
  // Context starts after the header, segment header, opcode and event handle.
  new DataView(buffer).setUint8(32 + 8 + 5 + 2, 3);
  assert.throws(() => decode(buffer), /Invalid tennis context/);
  const absent = context();
  absent.points = [null, null];
  absent.server = 0;
  assert.ok(isTennisContext(absent));
  assert.ok(!tennisContextAgrees(absent, absent));
  assert.ok(sameTennisContext(absent, structuredClone(absent)));
});

test("tennis opens and updates opportunities with sport, scoring context, prices and correct payouts", () => {
  const f = setup();
  f.pair();
  const opened = f.opportunities().at(-1);
  assert.equal(opened.kind, "open");
  assert.equal(opened.sport, "tennis");
  assert.deepEqual(
    opened.legs.map((l) => [l.provider, l.label, l.price]),
    [
      ["superbet", "Peste 22.5", 2.1],
      ["betano", "Sub 22.5", 2.15],
    ],
  );
  assert.ok(
    Math.abs(opened.marginBps - (1 / (1 / 2.1 + 1 / 2.15) - 1) * 10000) < 0.01,
  );
  assert.ok(opened.score.includes("puncte 15-30"));
  f.batch("betano", (s) => s.value(0, 1.75, 2.3, 3));
  assert.equal(f.opportunities().at(-1).kind, "update");
  assert.equal(f.opportunities().at(-1).id, opened.id);
  f.batch("superbet", (s) => s.value(0, 1.5, 1.8, 3));
  const closed = f.opportunities().at(-1);
  assert.equal(closed.kind, "close");
  assert.equal(closed.reason, "margin");
  assert.ok(closed.reasonDetail.includes("superbet Peste 22.5"));
});

test("every tennis scoring contradiction blocks comparisons even while set counts agree", () => {
  for (const change of [
    (c) => (c.points[0] = 30),
    (c) => (c.server = 2),
    (c) => (c.server = 0),
    (c) => (c.points[1] = null),
    (c) => (c.sets[0][0] = 4),
    (c) => (c.currentSet = 2),
    (c) => (c.sets = []),
    (c) => (c.sets[0][1] = null),
  ]) {
    const f = setup(),
      other = context();
    change(other);
    f.pair({ betano: other });
    assert.equal(f.engine.getStats().matching.confirmed, 1);
    assert.equal(f.engine.getStats().activeMatches, 0);
    assert.equal(f.opportunities().length, 0);
  }
  const f = setup();
  f.pair();
  assert.equal(f.engine.getStats().activeMatches, 1);
  const moved = context();
  moved.points[0] = 30;
  f.batch("superbet", (s) => s.eventTennis(0, moved));
  assert.equal(f.opportunities().at(-1).reason, "tennis-context");
  assert.equal(f.engine.getStats().activeMatches, 0);
  f.batch("betano", (s) => s.eventTennis(0, moved));
  assert.equal(f.opportunities().at(-1).kind, "open");
  assert.equal(f.engine.getStats().activeMatches, 1);
});

test("tennis skips completed set lines and never links different thresholds or set numbers", () => {
  const f = setup();
  f.pair();
  f.batch("superbet", (s) => {
    s.lineDefine(1, 0, lineKey(1005, 38, 1));
    s.value(1, 2.1, 1.8, 3);
  });
  f.batch("betano", (s) => {
    s.lineDefine(1, 0, lineKey(1005, 38, 2));
    s.value(1, 1.75, 2.15, 3);
  });
  assert.equal(f.engine.getStats().opportunities.linkedLines, 1);
  f.batch("betano", (s) => {
    s.lineDefine(2, 0, lineKey(1005, 38, 1));
    s.value(2, 1.75, 2.15, 3);
  });
  assert.ok(
    f.opportunities().some((r) => r.concept === "Setul 1 - Total game-uri"),
  );
  const next = {
    ...context(),
    currentSet: 2,
    sets: [
      [6, 3],
      [0, 0],
    ],
    points: [0, 0],
  };
  f.batch("superbet", (s) => s.eventTennis(0, next));
  f.batch("betano", (s) => s.eventTennis(0, next));
  assert.ok(
    f
      .opportunities()
      .filter((r) => r.marketCode === 1005)
      .at(-1).kind === "close",
  );
  const latest = f
    .opportunities()
    .filter((r) => r.marketCode === 1005)
    .at(-1);
  assert.equal(latest.reason, "tennis-context");
  f.batch("superbet", (s) => s.value(0, 2.1, 1.8, 0));
  assert.equal(f.engine.getStats().activeMatches, 0); // Only completed-set lines remain usable.
});

test("tennis pair confirmation requires names, IDs and orientation and never learns football aliases", () => {
  const f = setup();
  f.batch("superbet", (s) => s.eventIdentity(0, match(11)));
  f.batch("betano", (s) =>
    s.eventIdentity(0, {
      ...match(22),
      home: "Unrelated Player",
      away: "Another Player",
    }),
  );
  assert.equal(f.engine.getStats().matching.confirmed, 0);
  assert.ok(f.records.at(-1).reasons.includes("unverified"));
  const missing = setup();
  missing.batch("superbet", (s) =>
    s.eventIdentity(0, { ...match(11), betradarId: 0 }),
  );
  missing.batch("betano", (s) => s.eventIdentity(0, match(22)));
  assert.equal(missing.engine.getStats().matching.confirmed, 0);
  const duplicate = setup();
  duplicate.pair();
  duplicate.batch("superbet", (s) => s.eventIdentity(1, match(33)));
  assert.equal(duplicate.engine.getStats().matching.conflicts, 1);
  assert.equal(duplicate.opportunities().at(-1).kind, "close");
  const normal = setup();
  normal.pair();
  normal.advance(360000);
  assert.equal(normal.engine.getStats().matching.aliases, 0);
});

test("shared projection adapters preserve tennis opportunity identity across the actual binary wire", async (t) => {
  const options = {
    ...aggregationConfig,
    maxEvents: 4,
    maxLines: 16,
    maxBatchBytes: 2 * fullStateBytes(4, 16),
    batchWindowMs: 1,
    scoreSettleMs: 1,
  };
  const records = [],
    errors = [];
  const engine = new AggregationEngine(
    options,
    new LearnedTables(null, assert.fail),
    { onRecord: (r) => records.push(r) },
    "tennis",
  );
  function side(provider, codec) {
    const { port1, port2 } = new MessageChannel();
    const snapshot = {
      event: projectionEvent(provider),
      lines: [projectionLine(provider)],
      synchronized: true,
    };
    let adapter;
    const outbox = new AggregationOutbox(port2, provider, {
      onResync: () => adapter.resync(),
      onError: (e) => errors.push(e),
    });
    adapter = new ProjectionAggregationAdapter(
      outbox,
      codec,
      () => [snapshot],
      tennisMarketMapping,
    );
    const session = new AggregationSession(
      provider,
      port1,
      1,
      options,
      { onError: (_, e) => errors.push(e) },
      engine.sink(provider),
    );
    session.start();
    t.after(() => {
      outbox.close();
      session.close();
    });
    const send = async (action) => {
      const before = session.getStats().batches;
      action();
      await until(
        () =>
          session.getStats().batches > before && !outbox.getStats().inFlight,
      );
    };
    return { snapshot, outbox, adapter, session, send };
  }
  const sb = side("superbet", superbetTennisCodec),
    bt = side("betano", betanoTennisCodec);
  await until(
    () =>
      sb.session.getStats().lines === 1 && bt.session.getStats().lines === 1,
  );
  await tick(5);
  engine.sweep(Date.now());
  const reports = () => records.filter((r) => r.type === "opportunity");
  const opened = reports().at(-1);
  assert.equal(opened.kind, "open");
  await sb.send(() => {
    sb.snapshot.synchronized = false;
    sb.adapter.update({
      kind: "invalidate",
      eventId: 11,
      upserts: [],
      removed: [],
    });
  });
  assert.equal(reports().at(-1).kind, "pause");
  const staleCopy = sb.session.getStats();
  assert.equal(staleCopy.events, 1);
  assert.equal(staleCopy.lines, 1);
  // Replay of an invalidated projection must stay blocked through channel resynchronization.
  sb.adapter.resync();
  await tick(5);
  assert.equal(reports().at(-1).kind, "pause");
  await sb.send(() => {
    sb.snapshot.synchronized = true;
    sb.snapshot.lines[0] = {
      ...sb.snapshot.lines[0],
      key: "replacement-vendor-id",
    };
    sb.adapter.install(sb.snapshot);
  });
  assert.equal(reports().at(-1).kind, "resume");
  assert.equal(reports().at(-1).id, opened.id);
  await sb.send(() => {
    sb.snapshot.event = { ...sb.snapshot.event, player1Points: "30" };
    sb.adapter.update({
      kind: "update",
      eventId: 11,
      event: sb.snapshot.event,
      upserts: [],
      removed: [],
    });
  });
  assert.equal(reports().at(-1).reason, "tennis-context");
  await bt.send(() => {
    bt.snapshot.event = { ...bt.snapshot.event, player1Points: "30" };
    bt.adapter.update({
      kind: "update",
      eventId: 22,
      event: bt.snapshot.event,
      upserts: [],
      removed: [],
    });
  });
  assert.equal(reports().at(-1).kind, "open");
  await sb.send(() =>
    sb.adapter.update({
      kind: "remove",
      eventId: 11,
      upserts: [],
      removed: [],
    }),
  );
  assert.equal(reports().at(-1).reason, "unlinked");
  assert.equal(sb.session.getStats().events, 0);
  assert.deepEqual(errors, []);
});

test("one real aggregation worker isolates football and tennis even when IDs and handles collide", async () => {
  const errors = [],
    opportunities = [],
    matches = [];
  const controller = new AggregationController(
    {
      maxEvents: 8,
      maxLines: 32,
      maxBatchBytes: 2 * fullStateBytes(8, 32),
      batchWindowMs: 1,
      scoreSettleMs: 1,
      sweepMs: 5,
      reportIntervalMs: 5,
      statsIntervalMs: 20,
    },
    {
      onError: (e) => errors.push(e),
      onOpportunity: (r) => opportunities.push(r),
      onMatches: (m) => matches.push(m),
    },
  );
  const outboxes = [];
  for (const sport of ["football", "tennis"])
    for (const provider of ["superbet", "betano"]) {
      let outbox;
      outbox = new AggregationOutbox(
        controller.createPort(provider, sport),
        provider,
        {
          onError: (e) => errors.push(e),
          onResync: () => {
            outbox.setEvent(match(provider === "superbet" ? 11 : 22));
            outbox.setLive(provider === "superbet" ? 11 : 22, {
              live: true,
              suspended: false,
              homeScore: 0,
              awayScore: 0,
              clockSeconds: null,
              clockRunning: false,
              ...(sport === "tennis" ? { tennis: context() } : {}),
            });
            outbox.setLine(
              provider === "superbet" ? 11 : 22,
              lineKey(
                sport === "tennis" ? 1001 : 1,
                sport === "tennis" ? 90 : 10,
              ),
              ...(provider === "superbet" ? [2.1, 1.8] : [1.75, 2.15]),
              true,
              true,
            );
          },
        },
      );
      outboxes.push(outbox);
    }
  assert.throws(
    () => controller.createPort("betano", "tennis"),
    /already exists/,
  );
  assert.throws(
    () => controller.createPort("betano", "invalid"),
    /Unknown aggregation sport/,
  );
  try {
    await controller.start();
    await until(
      () =>
        opportunities.some((r) => r.sport === "tennis" && r.kind === "open") &&
        opportunities.some((r) => r.sport === "football" && r.kind === "open"),
    );
    const stats = await controller.getStats();
    assert.equal(stats.sports.tennis.matching.confirmed, 1);
    assert.equal(stats.sports.football.matching.confirmed, 1);
    assert.equal(stats.sports.tennis.opportunities.linkedLines, 1);
    assert.equal(stats.sports.football.opportunities.linkedLines, 1);
    await until(() => matches.at(-1)?.length === 2);
    assert.deepEqual(
      matches
        .at(-1)
        .map((m) => m.sport)
        .sort(),
      ["football", "tennis"],
    );
    assert.deepEqual(errors, []);
  } finally {
    for (const outbox of outboxes) outbox.close();
    await controller.stop();
  }
});

test("the full-state byte limit covers maximum tennis context and names without overflow", () => {
  const writer = new BatchWriter();
  writer.writeReset();
  const c = {
    sets: Array.from({ length: 5 }, () => [65533, 65533]),
    points: [65534, 65534],
    server: 2,
    doubles: 2,
    currentSet: 5,
  };
  for (let event = 0; event < 4; event++) {
    writer.eventIdentity(event, {
      ...match(event + 1),
      home: "\u4e00".repeat(128),
      away: "\u4e01".repeat(128),
    });
    writer.eventTennis(event, c);
    writer.eventLive(event, flags, 2, 2, 0);
    for (let i = 0; i < 2; i++) {
      const line = event * 2 + i;
      writer.lineDefine(line, event, key);
      writer.value(line, 2.1, 2.15, 3);
    }
  }
  const result = decode(writer.finish("superbet", 1, 1, now));
  assert.ok(result.header.byteLength <= fullStateBytes(4, 8));
  assert.equal(result.calls.filter((c) => c[0] === "tennis").length, 4);
  assert.deepEqual(result.calls.filter((c) => c[0] === "tennis")[0][2], c);
});

test("a tennis record on a football session clears that channel and requests repair", async (t) => {
  const options = {
    ...aggregationConfig,
    maxEvents: 4,
    maxLines: 8,
    maxBatchBytes: 2 * fullStateBytes(4, 8),
  };
  const engine = new AggregationEngine(
    options,
    new LearnedTables(null, assert.fail),
    { onRecord() {} },
  );
  const { port1, port2 } = new MessageChannel(),
    errors = [];
  const session = new AggregationSession(
    "superbet",
    port1,
    1,
    options,
    { onError: (_, e) => errors.push(e) },
    engine.sink("superbet"),
  );
  t.after(() => {
    session.close();
    port2.close();
  });
  const attached = once(port2, "message");
  session.start();
  await attached;
  const writer = new BatchWriter();
  writer.writeReset();
  writer.eventIdentity(0, match(11));
  writer.eventTennis(0, context());
  const buffer = writer.finish("superbet", 1, 1, Date.now()),
    reply = once(port2, "message");
  port2.postMessage({ type: "batch", generation: 1, sequence: 1, buffer }, [
    buffer,
  ]);
  assert.equal((await reply)[0].type, "resync");
  assert.equal(session.getStats().resyncs, 1);
  assert.equal(session.getStats().events, 0);
  assert.ok(
    errors.some((e) => e.includes("Tennis context on a football channel")),
  );
  assert.equal(engine.getStats().matching.unmatched.superbet.withId, 0);
});

test("console output omits match tables and formats tennis opportunities on one line", async () => {
  const { aggregationConsoleHandlers } =
    await import("../dist/aggregation/logging.js");
  const logs = [],
    tables = [],
    previousLog = console.log,
    previousTable = console.table;
  console.log = (...args) => logs.push(args.join(" "));
  console.table = (rows) => tables.push(rows);
  try {
    assert.equal(aggregationConsoleHandlers.onMatches, undefined);
    assert.equal(tables.length, 0);
    const f = setup();
    f.pair();
    aggregationConsoleHandlers.onOpportunity(f.opportunities().at(-1));
    assert.match(logs.at(-1), /FOUND.*\[TENNIS\]/);
    assert.ok(logs.at(-1).includes("Peste 22.5"));
    assert.equal(logs.at(-1).includes("\n"), false);
  } finally {
    console.log = previousLog;
    console.table = previousTable;
  }
});

test("tennis context overflow replays fresh handles without writing state to a different match", async (t) => {
  const { port1, port2 } = new MessageChannel();
  const states = new Map([
    [
      11,
      {
        live: true,
        suspended: false,
        homeScore: 0,
        awayScore: 0,
        clockSeconds: null,
        clockRunning: false,
        tennis: context(),
      },
    ],
    [
      22,
      {
        live: true,
        suspended: false,
        homeScore: 0,
        awayScore: 0,
        clockSeconds: null,
        clockRunning: false,
        tennis: { ...context(), points: [0, 0] },
      },
    ],
  ]);
  let resets = 0,
    outbox;
  outbox = new AggregationOutbox(port2, "superbet", {
    onError: assert.fail,
    onResync() {
      resets++;
      for (const id of resets === 1 ? [11, 22] : [22, 11]) {
        outbox.setEvent(match(id));
        outbox.setLive(id, states.get(id));
      }
    },
  });
  t.after(() => {
    outbox.close();
    port1.close();
  });
  const firstReply = once(port1, "message");
  port1.postMessage({
    type: "attach",
    generation: 1,
    options: {
      batchWindowMs: 1,
      maxEvents: 2,
      maxLines: 1,
      maxBatchBytes: 2 * fullStateBytes(2, 1),
      enabledConditions: ["D"],
    },
  });
  const [first] = await firstReply;
  for (let i = 1; i < 200 && resets < 2; i++) {
    states.set(11, {
      ...states.get(11),
      homeScore: i,
      tennis: { ...context(), points: [i, 30] },
    });
    outbox.setLive(11, states.get(11));
  }
  assert.equal(resets, 2);
  const nextReply = once(port1, "message");
  port1.postMessage(
    {
      type: "ack",
      generation: 1,
      sequence: first.sequence,
      buffer: first.buffer,
    },
    [first.buffer],
  );
  const [next] = await nextReply;
  const { calls } = decode(next.buffer);
  const identities = new Map(
    calls.filter((c) => c[0] === "identity").map((c) => [c[1], c[2].eventId]),
  );
  const lives = new Map(
    calls.filter((c) => c[0] === "live").map((c) => [identities.get(c[1]), c]),
  );
  assert.equal(lives.get(22)[3], 0);
  assert.equal(lives.get(11)[3], states.get(11).homeScore);
  const bad = { ...states.get(11), tennis: { ...context(), server: 3 } };
  assert.equal(outbox.setLive(11, bad), false);
  assert.equal(outbox.getStats().rejected, 1);
  const encoded = superbetTennisCodec.live({
    ...projectionEvent("superbet"),
    sets: [{ number: 1, player1Games: 1000000, player2Games: NaN }],
  }).tennis;
  assert.deepEqual(encoded.sets, [[null, null]]);
  assert.ok(isTennisContext(encoded));
  assert.equal(tennisContextAgrees(encoded, encoded), false);
});
