import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BetanoController } from "../dist/providers/betano/controller.js";
import { betanoConfig } from "../dist/providers/betano/config.js";
import { betanoTennisMarkets } from "../dist/providers/betano/tennis-markets.config.js";
import { tennisEvent } from "../dist/providers/betano/processing/tennis-markets.js";
import { BetanoTennisProjection } from "../dist/providers/betano/processing/tennis-projection.js";
import { projectPrematchTennis } from "../dist/providers/betano/processing/tennis-prematch.js";
import { BetanoStore } from "../dist/providers/betano/processing/state.js";
import { BetanoFeed } from "../dist/providers/betano/processing/feed.js";

const captures = JSON.parse(
  readFileSync(
    new URL("./fixtures/betano-tennis-markets.json", import.meta.url),
    "utf8",
  ),
);

function snapshot() {
  return {
    version: 10,
    event: {
      id: 11,
      sportId: "TENN",
      isLive: true,
      marketIdList: [101],
      startTime: 1792915500000,
      betradarMatchId: 75992876,
      participants: [
        { name: "Player (A+)", isHome: true, playerIds: [1] },
        { name: "Player B", playerIds: [2] },
      ],
      liveData: {
        score: { home: "30", away: "AD" },
        results: {
          liveInfoHomeScore: "1",
          liveInfoAwayScore: "0",
          currentPeriodNumber: 2,
          currentTennisGame: 14,
          currentGame: "Game 2",
          serverHome: true,
          setScoreList: [
            { home: "7", away: "5" },
            { home: "1", away: "0" },
          ],
        },
      },
    },
    markets: {
      101: {
        id: 101,
        typeId: 1541,
        type: "FTGO",
        name: "Game-uri",
        handicap: 22.5,
        selectionIdList: [201, 202],
      },
    },
    selections: {
      201: {
        id: 201,
        typeId: 4039,
        name: "Peste 22.5",
        fullName: "Peste",
        handicap: 22.5,
        price: 1.9,
      },
      202: {
        id: 202,
        typeId: 4040,
        name: "Sub 22.5",
        fullName: "Sub",
        handicap: 22.5,
        price: 1.95,
      },
    },
  };
}

function project(source = snapshot()) {
  const projection = new BetanoTennisProjection();
  projection.install(source, 1234);
  return projection.getSnapshot(source.event.id);
}

function synchronized() {
  const messages = [];
  const projection = new BetanoTennisProjection({
    onSnapshot: (snapshot) => messages.push({ kind: "snapshot", snapshot }),
    onUpdate: (change) => messages.push(change),
  });
  const store = new BetanoStore(8, {
    onSnapshot: (snapshot) => projection.install(snapshot),
    onUpdate: (diff) =>
      projection.update(store.getSnapshot(diff.eventId), diff),
    onStale: (id) => projection.invalidate(id),
    onRemove: (id) => projection.remove(id),
  });
  const base = snapshot();
  store.add(base.event);
  store.install(11, base);
  const receive = (
    type,
    payload,
    version = store.getSnapshot(11).version + 1,
  ) => store.receive({ eventId: 11, type, payload, version });
  return { store, projection, messages, receive };
}

test("Betano tennis catalog is explicit, unique, and excludes winners, combinations, unary and multiway types", () => {
  assert.equal(betanoTennisMarkets.length, 32);
  assert.equal(new Set(betanoTennisMarkets.map((m) => m.typeId)).size, 32);
  assert.deepEqual(
    betanoTennisMarkets.reduce(
      (counts, m) => ((counts[m.kind] = (counts[m.kind] || 0) + 1), counts),
      {},
    ),
    { handicap: 3, "yes-no": 6, total: 23 },
  );
  for (const market of betanoTennisMarkets) {
    assert.equal(market.outcomes.length, 2);
    assert.notEqual(market.outcomes[0].role, market.outcomes[1].role);
  }
  for (const excluded of [
    160, 163, 1356, 1360, 1362, 1365, 1382, 1383, 1385, 1386, 1493, 1499, 1514,
    5322, 5323, 5324, 5325, 5326, 5327, 5654, 5655, 5656, 1530, 1537, 1433,
    1464,
  ])
    assert.ok(!betanoTennisMarkets.some((m) => m.typeId === excluded));
});

test("all 32 prematch vendor examples project into complete pairs with separate thresholds", () => {
  const covered = new Set();
  for (const { event, market } of captures.prematch) {
    const result = projectPrematchTennis({ ...event, markets: [market] }, 1234);
    assert.ok(result?.lines.length > 0, market.name);
    assert.equal(result.sourceVersion, null);
    assert.equal(result.synchronized, true);
    assert.equal(result.event.phase, "prematch");
    assert.equal(result.event.betradarId, event.betRadarId);
    for (const line of result.lines) {
      assert.equal(line.selections.length, 2);
      assert.notEqual(line.selections[0].id, line.selections[1].id);
      assert.ok(line.selections.every((s) => s.outcomeId === null));
      covered.add(line.marketTypeId);
    }
  }
  assert.deepEqual(
    [...covered].sort((a, b) => a - b),
    betanoTennisMarkets.map((m) => m.typeId).sort((a, b) => a - b),
  );
});

test("captured live singles and doubles retain only exact verified pairs", () => {
  assert.equal(captures.live.length, 3);
  const counts = captures.live.map((base) => project(base).lines.length);
  assert.deepEqual(counts, [2, 17, 17]);
  for (const base of captures.live) {
    const result = project(base);
    assert.equal(result.event.phase, "live");
    assert.ok(result.lines.every((line) => line.selections.length === 2));
    assert.ok(
      result.lines.every((line) =>
        line.selections.every((s) => s.outcomeId !== null),
      ),
    );
  }
  const doubles = captures.live.find((s) => s.event.isTennisDoubles);
  const result = project(doubles);
  assert.equal(result.event.isDoubles, true);
  assert.equal(result.event.player1.playerIds.length, 2);
  // Vendor labels reordered this pair; participant-dependent markets must not be guessed.
  assert.deepEqual(
    result.lines.map((l) => l.marketTypeId).sort((a, b) => a - b),
    [1361, 1541],
  );
});

test("tennis context separates points, set results, current game and match-wide game number", () => {
  const source = snapshot(),
    previous = project(source);
  assert.equal(previous.event.player1Points, "30");
  assert.equal(previous.event.player2Points, "AD");
  assert.equal(previous.event.player1Sets, 1);
  assert.equal(previous.event.player2Sets, 0);
  assert.equal(previous.event.currentSetNumber, 2);
  assert.equal(previous.event.currentGameNumber, 2);
  assert.equal(previous.event.serving, "player1");
  assert.deepEqual(previous.event.sets, [
    { number: 1, player1Games: 7, player2Games: 5 },
    { number: 2, player1Games: 1, player2Games: 0 },
  ]);
  source.event.liveData.results.setScoreList[0].home = "99";
  source.event.participants[0].playerIds[0] = 99;
  assert.equal(previous.event.sets[0].player1Games, 7);
  assert.deepEqual(previous.event.player1.playerIds, [1]);
  const invalid = snapshot();
  Object.assign(invalid.event.liveData.results, {
    serverAway: true,
    currentPeriodNumber: 0,
    currentGame: "Game 0",
    setScoreList: [null],
    liveInfoHomeScore: "oops",
  });
  invalid.event.liveData.score.away = "bad";
  const event = project(invalid).event;
  assert.equal(event.serving, null);
  assert.equal(event.currentSetNumber, null);
  assert.equal(event.currentGameNumber, null);
  assert.equal(event.player1Sets, null);
  assert.equal(event.player2Points, null);
  assert.deepEqual(event.sets, []);
});

test("invalid identities, other sports, ended matches, and malformed doubles IDs fail closed", () => {
  const changes = [
    (s) => (s.event.sportId = "FOOT"),
    (s) => (s.event.isEnded = true),
    (s) => delete s.event.isLive,
    (s) => (s.event.id = -1),
    (s) => s.event.participants.pop(),
    (s) => (s.event.participants[0] = null),
    (s) => (s.event.participants[1].isHome = true),
    (s) => delete s.event.participants[0].isHome,
    (s) => (s.event.participants[1].name = s.event.participants[0].name),
    (s) => (s.event.participants[1].playerIds = [1]),
    (s) => (s.event.participants[0].playerIds = [1, 1]),
    (s) => (s.event.participants[0].playerIds = [1, 2, 3]),
  ];
  for (const change of changes) {
    const s = snapshot();
    change(s);
    assert.equal(project(s), null);
  }
  for (const id of [0, -1, "75992876", NaN, 2 ** 60]) {
    const s = snapshot();
    s.event.betradarMatchId = id;
    assert.equal(tennisEvent(s).betradarId, null);
  }
});

test("cardinality includes suspended members and unknown or duplicate members never form pairs", () => {
  const source = snapshot();
  source.selections[201].isSuspended = true;
  assert.equal(project(source).lines[0].selections[0].isSuspended, true);
  source.markets[101].selectionIdList.push(203);
  source.selections[203] = {
    ...source.selections[201],
    id: 203,
    isSuspended: true,
  };
  assert.equal(project(source).lines.length, 0);
  for (const ids of [[201], [201, 201], [201, 999]]) {
    const s = snapshot();
    s.markets[101].selectionIdList = ids;
    assert.equal(project(s).lines.length, 0);
  }
});

test("type, outcome IDs, labels and numeric thresholds must all agree", () => {
  const changes = [
    (s) => (s.markets[101].type = "UNKNOWN"),
    (s) => (s.markets[101].name = "Total game-uri"),
    (s) => (s.selections[201].typeId = 4040),
    (s) => delete s.selections[201].typeId,
    (s) => (s.selections[201].name = "Peste 023"),
    (s) => (s.selections[201].fullName = "Sub"),
    (s) => (s.selections[201].handicap = 21.5),
    (s) => (s.markets[101].handicap = 21.5),
    (s) => {
      s.markets[101].handicap = 22.25;
      for (const sel of Object.values(s.selections)) {
        sel.handicap = 22.25;
        sel.name = sel.name.replace("22.5", "22.25");
      }
    },
  ];
  for (const change of changes) {
    const source = snapshot();
    change(source);
    assert.equal(project(source).lines.length, 0);
  }
  for (const price of [0, 1, NaN, Infinity, undefined]) {
    const source = snapshot();
    source.selections[201].price = price;
    assert.equal(project(source).lines[0].selections[0].price, null);
  }
});

test("set templates preserve coordinates and handicap signs are oriented to player1", () => {
  const sample = captures.prematch.find((x) => x.market.typeId === 1381);
  const source = {
    ...structuredClone(sample.event),
    markets: [structuredClone(sample.market)],
  };
  const lines = projectPrematchTennis(source).lines;
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    assert.equal(line.setNumber, 1);
    assert.equal(line.handicap, line.selections[0].handicap);
    assert.equal(line.selections[1].handicap, -line.handicap);
  }
  for (const name of [
    "Game-uri Handicap  (Set 0)",
    "Game-uri Handicap  (Set 6)",
    "Game-uri Handicap (Set 1)",
  ]) {
    source.markets[0].name = name;
    assert.equal(projectPrematchTennis(source).lines.length, 0);
  }
  const numeric = captures.prematch.find((x) => x.market.typeId === 1512);
  const second = {
    ...structuredClone(numeric.event),
    markets: [structuredClone(numeric.market)],
  };
  second.markets[0].name = "Game-uri totale set (Set 2)";
  assert.ok(
    projectPrematchTennis(second).lines.every((l) => l.setNumber === 2),
  );
});

test("prematch duplicates are deduplicated, conflicting copies and reused IDs are rejected", () => {
  const sample = captures.prematch.find((x) => x.market.typeId === 1541);
  const source = {
    ...structuredClone(sample.event),
    markets: [structuredClone(sample.market), structuredClone(sample.market)],
  };
  const count = projectPrematchTennis(source).lines.length;
  assert.ok(count > 1);
  assert.equal(
    count,
    projectPrematchTennis({ ...source, markets: [source.markets[0]] }).lines
      .length,
  );
  source.markets[1].selections[0].price += 0.1;
  assert.equal(projectPrematchTennis(source), null);
  source.markets[1] = structuredClone(source.markets[0]);
  source.markets[1].id = "987654";
  assert.equal(projectPrematchTennis(source), null);
  source.participants[0] = null;
  assert.equal(projectPrematchTennis(source), null);
});

test("ordered price and context updates emit complete pairs, and unrelated changes only advance version", () => {
  const f = synchronized();
  const previous = f.projection.getSnapshot(11);
  f.receive(100, { selectionChanges: { 101: [{ id: 201, price: 2.1 }] } });
  assert.equal(f.messages.at(-1).upserts.length, 1);
  assert.deepEqual(
    f.messages.at(-1).upserts[0].selections.map((s) => s.price),
    [2.1, 1.95],
  );
  assert.equal(previous.lines[0].selections[0].price, 1.9);
  const liveData = structuredClone(f.store.getSnapshot(11).event.liveData);
  liveData.score.home = "40";
  liveData.results.serverHome = false;
  liveData.results.serverAway = true;
  f.receive(300, { liveData });
  assert.equal(f.messages.at(-1).event.player1Points, "40");
  assert.equal(f.messages.at(-1).event.serving, "player2");
  assert.deepEqual(f.messages.at(-1).upserts, []);
  const count = f.messages.length;
  f.receive(16, { event: { aces: 3 } });
  assert.equal(f.messages.length, count);
  assert.equal(f.projection.getSnapshot(11).sourceVersion, 13);
  f.receive(150, { id: 202, price: 2.3 });
  assert.equal(f.messages.at(-1).upserts[0].selections[1].price, 2.3);
});

test("structural changes maintain the reverse index and remove unavailable lines", () => {
  const f = synchronized();
  f.receive(105, { id: 101, isSuspended: true });
  assert.equal(f.messages.at(-1).upserts[0].isSuspended, true);
  f.receive(100, { selectionChanges: { 101: [{ id: 201 }] } });
  assert.equal(f.projection.getSnapshot(11).lines[0].selections[0].price, null);
  f.receive(106, { selectionIds: { 101: [201] } });
  assert.deepEqual(f.messages.at(-1).removed, ["101:22.5"]);
  f.receive(106, { selectionIds: { 101: [201, 202] } });
  assert.equal(f.messages.at(-1).upserts.length, 1);
  f.receive(105, { id: 101, typeId: 9999 });
  assert.equal(f.projection.getSnapshot(11).lines.length, 0);
  f.receive(150, { id: 201, price: 2 });
  assert.equal(f.projection.getSnapshot(11).lines.length, 0);
  f.receive(105, { id: 101, typeId: 1541 });
  assert.equal(f.messages.at(-1).upserts[0].selections[0].price, 2);
  f.receive(102, { marketIds: [101] });
  assert.deepEqual(f.messages.at(-1).removed, ["101:22.5"]);
});

test("gaps and disconnects retain blocked identity until repair and ended events are removed", () => {
  const f = synchronized();
  f.receive(100, {}, 12);
  assert.equal(f.projection.getSnapshot(11), null);
  assert.equal(f.messages.at(-1).kind, "invalidate");
  assert.equal([...f.projection.snapshots()][0].synchronized, false);
  const count = f.messages.length;
  const untrusted = snapshot();
  untrusted.version = 12;
  assert.equal(
    f.projection.update(untrusted, {
      eventId: 11,
      type: 100,
      version: 12,
      payload: {},
    }),
    null,
  );
  assert.equal(f.messages.length, count);
  f.store.install(11, untrusted);
  assert.equal(f.messages.at(-1).kind, "snapshot");
  assert.equal(f.projection.getSnapshot(11).synchronized, true);
  f.receive(2, { isEnded: true });
  assert.equal(f.projection.getSnapshot(11), null);
  assert.equal(f.messages.at(-1).kind, "remove");
  assert.deepEqual([...f.projection.snapshots()], []);
});

test("feed integration keeps tennis separate from football and invalidates, repairs and clears it", async () => {
  const snapshots = [],
    changes = [],
    football = [];
  const feed = new BetanoFeed({ command: async () => ({}) }, betanoConfig, {
    onEvents() {},
    onSnapshot() {},
    onUpdate() {},
    onRemove() {},
    onStatus() {},
    onError(error) {
      assert.fail(error);
    },
    onTennisSnapshot: (s) => snapshots.push(s),
    onTennisUpdate: (c) => changes.push(c),
    onFootballSnapshot: (s) => football.push(s),
  });
  const base = snapshot();
  try {
    feed.store.add(base.event);
    feed.store.install(11, base);
    assert.equal(snapshots.length, 1);
    assert.equal(football.length, 0);
    assert.equal(feed.getFootballSnapshot(11), null);
    assert.equal(feed.getTennisSnapshot(11).lines.length, 1);
    feed.store.receive({
      eventId: 11,
      type: 150,
      version: 11,
      payload: { id: 201, price: 2.3 },
    });
    assert.equal(changes.at(-1).upserts[0].selections[0].price, 2.3);
    feed.store.invalidate(11, "Disconnected");
    assert.equal(feed.getTennisSnapshot(11), null);
    assert.equal(changes.at(-1).kind, "invalidate");
    base.version = 12;
    feed.store.install(11, base);
    assert.equal(snapshots.length, 2);
    assert.equal(feed.getTennisSnapshot(11).synchronized, true);
    const other = snapshot();
    other.event.id = 12;
    other.event.sportId = "FOOT";
    feed.store.add(other.event);
    feed.store.install(12, other);
    assert.equal(feed.getTennisSnapshot(12), null);
    feed.store.remove(11);
    assert.equal(changes.at(-1).kind, "remove");
    base.version = 13;
    feed.store.add(base.event);
    feed.store.install(11, base);
  } finally {
    await feed.stop();
  }
  assert.equal(feed.getTennisSnapshot(11), null);
  assert.equal(changes.at(-1).kind, "remove");
  const controller = new BetanoController();
  for (const id of [0, -1, NaN, Infinity, 1.5, "11"])
    await assert.rejects(
      controller.getTennisSnapshot(id),
      /Invalid Betano event ID/,
    );
});
