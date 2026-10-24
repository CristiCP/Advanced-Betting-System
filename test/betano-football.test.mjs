import assert from "node:assert/strict";
import test from "node:test";
import { betanoFootballMarkets } from "../dist/providers/betano/football-markets.config.js";
import { BetanoFootballProjection } from "../dist/providers/betano/processing/football-projection.js";
import { projectPrematchFootball } from "../dist/providers/betano/processing/football-prematch.js";
import { BetanoStore } from "../dist/providers/betano/processing/state.js";
import { BetanoFeed } from "../dist/providers/betano/processing/feed.js";
import { betanoConfig } from "../dist/providers/betano/config.js";

function snapshot() {
  return {
    version: 10,
    event: {
      id: 11,
      sportId: "FOOT",
      isLive: true,
      marketIdList: [101],
      startTime: 1792848000000,
      leagueId: 1,
      zoneId: 2,
      participants: [
        { name: "Home (A+)", teamId: 1, isHome: true },
        { name: "Away", teamId: 2 },
      ],
      liveData: {
        score: { home: "0", away: "0" },
        clock: { secondsSinceStart: 123, clockStopped: false },
      },
    },
    markets: {
      101: {
        id: 101,
        typeId: 13,
        type: "HCTG",
        name: "Total goluri Peste/Sub",
        handicap: 2.5,
        selectionIdList: [201, 202],
      },
    },
    selections: {
      201: {
        id: 201,
        typeId: 39,
        name: "Peste 2.5",
        fullName: "Peste",
        handicap: 2.5,
        price: 1.9,
      },
      202: {
        id: 202,
        typeId: 40,
        name: "Sub 2.5",
        fullName: "Sub",
        handicap: 2.5,
        price: 1.95,
      },
    },
  };
}
function project(source = snapshot()) {
  const view = new BetanoFootballProjection();
  view.install(source, 1234);
  return view.getSnapshot(11);
}
function synchronized() {
  const messages = [];
  const view = new BetanoFootballProjection({
    onSnapshot: (v) => messages.push({ kind: "snapshot", value: v }),
    onUpdate: (v) => messages.push(v),
  });
  const store = new BetanoStore(8, {
    onSnapshot: (v) => view.install(v),
    onUpdate: (d) => view.update(store.getSnapshot(d.eventId), d),
    onStale: (id) => view.remove(id),
    onRemove: (id) => view.remove(id),
  });
  const base = snapshot();
  store.add(base.event);
  store.install(11, base);
  const receive = (
    type,
    payload,
    version = store.getSnapshot(11).version + 1,
  ) => store.receive({ eventId: 11, version, type, payload });
  return { messages, view, store, receive };
}
function prematch() {
  return {
    id: "11",
    sportId: "FOOT",
    name: "Home (A+) - Away",
    startTime: 1792848000000,
    participants: [
      { id: "1", name: "Home (A+)" },
      { id: "2", name: "Away" },
    ],
    markets: [
      {
        id: "101",
        typeId: 13,
        type: "HCTG",
        name: "Total goluri Peste/Sub",
        handicap: 0.5,
        selections: [
          { id: "201", name: "Peste 0.5", handicap: 0.5, price: 1.1 },
          { id: "202", name: "Sub 0.5", handicap: 0.5, price: 7 },
          { id: "203", name: "Peste 2.5", handicap: 2.5, price: 1.9 },
          { id: "204", name: "Sub 2.5", handicap: 2.5, price: 1.95 },
        ],
      },
    ],
  };
}

test("catalog has fixed distinct outcome pairs and excludes European, combined, player and parity markets", () => {
  assert.equal(betanoFootballMarkets.length, 94);
  assert.equal(new Set(betanoFootballMarkets.map((m) => m.typeId)).size, 94);
  for (const m of betanoFootballMarkets) {
    assert.equal(m.outcomes.length, 2);
    assert.notEqual(m.outcomes[0].role, m.outcomes[1].role);
  }
  for (const id of [1, 9, 10, 23, 24, 55, 59, 60, 148, 201, 596, 3966])
    assert.ok(!betanoFootballMarkets.some((m) => m.typeId === id));
});

test("projection copies minimal event context and orders roles independently of the source list", () => {
  const base = snapshot();
  base.markets[101].selectionIdList.reverse();
  const value = project(base);
  assert.equal(value.lines.length, 1);
  assert.equal(value.lines[0].total, 2.5);
  assert.deepEqual(
    value.lines[0].selections.map((s) => s.role),
    ["over", "under"],
  );
  assert.equal(value.event.clockSeconds, 123);
  assert.equal(value.sourceVersion, 10);
  base.selections[201].price = 7;
  base.event.participants[0].name = "Changed";
  assert.equal(value.lines[0].selections[0].price, 1.9);
  assert.equal(value.event.home.name, "Home (A+)");
});

test("exact cardinality is checked before suspension and unusable prices remain explicit", () => {
  for (const ids of [[201], [201, 202, 203], [201, 201, 202]]) {
    const base = snapshot();
    base.markets[101].selectionIdList = ids;
    base.selections[203] = {
      ...base.selections[201],
      id: 203,
      isSuspended: true,
    };
    assert.equal(project(base).lines.length, 0);
  }
  const base = snapshot();
  base.selections[202].isSuspended = true;
  base.selections[201].price = 0;
  const line = project(base).lines[0];
  assert.equal(line.selections.length, 2);
  assert.equal(line.selections[0].price, null);
  assert.equal(line.selections[1].isSuspended, true);
});

test("unknown types, altered names, outcome IDs, labels, memberships, and mismatched thresholds fail closed", () => {
  const changes = [
    (s) => (s.markets[101].typeId = 9999),
    (s) => (s.markets[101].type = "OTHER"),
    (s) => (s.markets[101].name += " special"),
    (s) => (s.selections[201].typeId = 40),
    (s) => (s.selections[201].name = "Peste 3.5"),
    (s) => (s.selections[201].fullName = "Player"),
    (s) => (s.selections[201].handicap = "2.5"),
    (s) => (s.selections[201].handicap = NaN),
    (s) => (s.markets[101].handicap = 3.5),
    (s) => (s.selections[202].handicap = 3.5),
    (s) => delete s.selections[202],
    (s) => (s.event.marketIdList = []),
  ];
  for (const change of changes) {
    const base = snapshot();
    change(base);
    assert.equal(project(base).lines.length, 0);
  }
});

test("handicap signs, zero, exact team names and source score context are retained", () => {
  for (const handicap of [-1.25, 0, 0.75]) {
    const base = snapshot();
    Object.assign(base.markets[101], {
      typeId: 185,
      type: "AHRF",
      name: "Handicap Asiatic (Scorul actual 1 - 0)",
      handicap,
    });
    Object.assign(base.selections[201], {
      typeId: 6766,
      name: `Home (A+) ${handicap}`,
      fullName: "Home (A+)",
      teamId: 1,
      handicap,
    });
    Object.assign(base.selections[202], {
      typeId: 6767,
      name: `Away ${-handicap}`,
      fullName: "Away",
      teamId: 2,
      handicap: -handicap,
    });
    const line = project(base).lines[0];
    assert.equal(line.handicap, handicap);
    assert.equal(line.selections[1].handicap, -handicap || 0);
    assert.deepEqual(line.scoreContext, { home: 1, away: 0 });
    base.selections[201].teamId = 2;
    assert.equal(project(base).lines.length, 0);
  }
});

test("intervals preserve seconds and period boundaries; malformed or shifted intervals are rejected", () => {
  for (const [label, expected] of [
    ["00:00 - 14:59", [0, 899, false]],
    ["30:00 - 45:00", [1800, 2700, true]],
  ]) {
    const base = snapshot();
    Object.assign(base.markets[101], {
      typeId: 130,
      type: "OTGO",
      name: `Interval goluri Peste/Sub (${label})`,
    });
    base.selections[201].typeId = 395;
    base.selections[202].typeId = 396;
    const value = project(base).lines[0].interval;
    assert.deepEqual(
      [value.fromSecond, value.toSecond, value.endsAtPeriodBoundary],
      expected,
    );
  }
  for (const label of [
    "01:00 - 15:59",
    "00:00 - 15:00",
    "30:00 - 44:60",
    "90:00 - 99:59",
  ]) {
    const base = snapshot();
    Object.assign(base.markets[101], {
      typeId: 130,
      type: "OTGO",
      name: `Interval goluri Peste/Sub (${label})`,
    });
    base.selections[201].typeId = 395;
    base.selections[202].typeId = 396;
    assert.equal(project(base).lines.length, 0);
  }
});

test("binary labels and IDs are fixed; a third or missing side cannot become a binary line", () => {
  const base = snapshot();
  Object.assign(base.markets[101], {
    typeId: 15,
    type: "BTSC",
    name: "Ambele echipe înscriu",
  });
  Object.assign(base.selections[201], {
    typeId: 43,
    name: "Da (GG)",
    fullName: "Da (GG)",
  });
  Object.assign(base.selections[202], {
    typeId: 44,
    name: "Nu (NG)",
    fullName: "Nu (NG)",
  });
  assert.equal(project(base).lines[0].total, null);
  base.selections[202].name = "Nu";
  assert.equal(project(base).lines.length, 0);
});

test("prematch groups thresholds into pairs, deduplicates identical tab copies, and exposes no invented version", () => {
  const source = prematch();
  source.markets.push(structuredClone(source.markets[0]));
  const value = projectPrematchFootball(source, 1234);
  assert.equal(value.sourceVersion, null);
  assert.equal(value.event.phase, "prematch");
  assert.deepEqual(
    value.lines.map((l) => l.total),
    [0.5, 2.5],
  );
  assert.ok(value.lines.every((l) => l.selections.length === 2));
  assert.ok(
    value.lines.every((l) => l.selections.every((s) => s.outcomeId === null)),
  );
  source.markets[1].selections[0].price = 9;
  assert.equal(projectPrematchFootball(source), null);
});

test("prematch rejects conflicting memberships, keeps other complete thresholds, and validates team placeholders", () => {
  const source = prematch();
  source.markets[0].selections.pop();
  assert.deepEqual(
    projectPrematchFootball(source).lines.map((l) => l.total),
    [0.5],
  );
  source.markets[0].name = "Home (A+) - Total goluri Peste/Sub";
  source.markets[0].typeId = 84;
  source.markets[0].type = "OUHG";
  assert.equal(projectPrematchFootball(source).lines.length, 1);
  source.markets[0].name = "Other - Total goluri Peste/Sub";
  assert.equal(projectPrematchFootball(source).lines.length, 0);
  const duplicate = prematch();
  duplicate.markets[0].selections.push(
    structuredClone(duplicate.markets[0].selections[0]),
  );
  assert.equal(projectPrematchFootball(duplicate), null);
});

test("ordered prices emit one complete upsert and old baseline objects remain unchanged", () => {
  const f = synchronized(),
    original = f.view.getSnapshot(11);
  f.receive(100, { selectionChanges: { 101: [{ id: 201, price: 2.1 }] } });
  const change = f.messages.at(-1);
  assert.equal(change.upserts.length, 1);
  assert.equal(change.upserts[0].selections.length, 2);
  assert.equal(change.upserts[0].selections[0].price, 2.1);
  assert.equal(original.lines[0].selections[0].price, 1.9);
  const count = f.messages.length;
  f.receive(16, { event: { 1: { value: 9 } } });
  assert.equal(f.messages.length, count);
  assert.equal(f.view.getSnapshot(11).sourceVersion, 12);
  f.receive(100, { selectionChanges: { 101: [{ id: 201, price: 9 }] } }, 11);
  assert.equal(f.messages.length, count);
  assert.equal(f.view.getSnapshot(11).lines[0].selections[0].price, 2.1);
});

test("store defaults, market/selection settings and event-only changes reach the filtered view", () => {
  const f = synchronized();
  f.receive(100, {
    selectionChanges: { 101: [{ id: 201, isSuspended: true }] },
  });
  assert.equal(f.messages.at(-1).upserts[0].selections[0].price, null);
  f.receive(105, { id: 101, isSuspended: true });
  assert.equal(f.messages.at(-1).upserts[0].isSuspended, true);
  f.receive(150, { id: 202, price: 2.3 });
  assert.equal(f.messages.at(-1).upserts[0].selections[1].price, 2.3);
  f.receive(3, { isSuspended: true });
  assert.equal(f.messages.at(-1).event.isSuspended, true);
  assert.deepEqual(f.messages.at(-1).upserts, []);
  f.receive(300, {
    liveData: {
      score: { home: "1", away: "0" },
      clock: { secondsSinceStart: 200, clockStopped: true },
    },
  });
  assert.equal(f.messages.at(-1).event.homeScore, "1");
});

test("selection removal/addition and reordered memberships emit removals or complete pairs", () => {
  const f = synchronized();
  const selection = structuredClone(f.store.getSnapshot(11).selections[202]);
  f.receive(102, { selectionIds: { 101: [202] } });
  assert.deepEqual(f.messages.at(-1).removed, ["101:2.5"]);
  f.receive(101, { selections: { 101: [selection] } });
  assert.equal(f.messages.at(-1).upserts.length, 1);
  const count = f.messages.length;
  f.receive(106, { selectionIds: { 101: [202, 201] } });
  assert.equal(f.messages.length, count);
  f.receive(106, { marketIds: [] });
  assert.deepEqual(f.messages.at(-1).removed, ["101:2.5"]);
  f.receive(105, { id: 101, isSuspended: true });
  assert.equal(f.view.getSnapshot(11).lines.length, 0);
  f.receive(106, { marketIds: [101] });
  assert.equal(f.messages.at(-1).upserts.length, 1);
  f.receive(102, { marketIds: [101] });
  assert.deepEqual(f.messages.at(-1).removed, ["101:2.5"]);
});

test("gap or disconnect invalidates immediately and recovery publishes a fresh baseline", () => {
  const f = synchronized();
  f.receive(100, {}, 12);
  assert.equal(f.view.getSnapshot(11), null);
  assert.equal(f.messages.at(-1).kind, "invalidate");
  const replacement = snapshot();
  replacement.version = 12;
  f.store.install(11, replacement);
  assert.equal(f.messages.at(-1).kind, "snapshot");
  f.store.invalidate(11, "Disconnected");
  assert.equal(f.view.getSnapshot(11), null);
  replacement.version = 13;
  f.store.install(11, replacement);
  f.store.remove(11);
  assert.equal(f.view.getSnapshot(11), null);
  assert.equal(f.messages.at(-1).kind, "invalidate");
});

test("unsupported market selection indexes are excluded and a catalog type change installs them", () => {
  const base = snapshot();
  base.markets[101].typeId = 9999;
  const view = new BetanoFootballProjection();
  const store = new BetanoStore(8, {
    onSnapshot: (s) => view.install(s),
    onUpdate: (d) => view.update(store.getSnapshot(d.eventId), d),
    onStale: (id) => view.remove(id),
    onRemove: (id) => view.remove(id),
  });
  store.add(base.event);
  store.install(11, base);
  assert.equal(view.events.get(11).selectionMarkets.size, 0);
  store.receive({
    eventId: 11,
    version: 11,
    type: 105,
    payload: { id: 101, typeId: 13 },
  });
  assert.equal(view.getSnapshot(11).lines.length, 1);
  store.receive({
    eventId: 11,
    version: 12,
    type: 150,
    payload: { id: 201, price: 2.5 },
  });
  assert.equal(view.getSnapshot(11).lines[0].selections[0].price, 2.5);
  store.receive({
    eventId: 11,
    version: 13,
    type: 105,
    payload: { id: 101, typeId: 9999 },
  });
  assert.equal(view.getSnapshot(11).lines.length, 0);
  assert.equal(view.events.get(11).selectionMarkets.size, 0);
});

test("unsupported sports, ended matches and shutdown expose no usable football snapshot", async () => {
  for (const change of [
    (s) => (s.event.sportId = "TENN"),
    (s) => (s.event.isEnded = true),
    (s) => s.event.participants.pop(),
    (s) => (s.event.participants[0] = null),
    (s) => (s.event.participants[0].name = 42),
    (s) => (s.event.participants[1].teamId = 1),
  ]) {
    const base = snapshot();
    change(base);
    assert.equal(project(base), null);
  }
  const changes = [],
    feed = new BetanoFeed({ command: async () => ({}) }, betanoConfig, {
      onEvents() {},
      onSnapshot() {},
      onUpdate() {},
      onRemove() {},
      onStatus() {},
      onError() {},
      onFootballUpdate: (c) => changes.push(c),
    });
  const base = snapshot();
  feed.store.add(base.event);
  feed.store.install(11, base);
  assert.equal(feed.getFootballSnapshot(11).lines.length, 1);
  feed.store.invalidate(11, "Disconnected");
  assert.equal(feed.getFootballSnapshot(11), null);
  base.version = 11;
  feed.store.install(11, base);
  await feed.stop();
  assert.equal(feed.getFootballSnapshot(11), null);
  assert.equal(changes.at(-1).kind, "invalidate");
});
