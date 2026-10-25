import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { superbetTennisMarkets } from "../dist/providers/superbet/tennis-markets.config.js";
import {
  tennisEvent,
  tennisLines,
} from "../dist/providers/superbet/processing/tennis-markets.js";
import { SuperbetTennisProjection } from "../dist/providers/superbet/processing/tennis-projection.js";
import { SuperbetStore } from "../dist/providers/superbet/processing/state.js";

const samples = JSON.parse(
  readFileSync(
    new URL("./fixtures/superbet-tennis-markets.json", import.meta.url),
    "utf8",
  ),
);
const total = () => ({
  id: 1002,
  name: "Total game-uri",
  odds: [
    {
      uuid: "under",
      price: 1.9,
      status: 1,
      display: true,
      metadata: {
        outcome_id: 4262,
        name: "Sub 20.5",
        offer_state_id: 2,
        market_line_uuid: "total",
        specifiers: { total: "20.5" },
      },
    },
    {
      uuid: "over",
      price: 1.9,
      status: 1,
      display: true,
      metadata: {
        outcome_id: 4263,
        name: "Peste 20.5",
        offer_state_id: 2,
        market_line_uuid: "total",
        specifiers: { total: "20.5" },
      },
    },
  ],
});
const snapshot = (markets = [total()], extra = {}) => ({
  event_id: 11,
  increment_id: 10,
  fixture: {
    sport_id: 2,
    event_name: "Alice\u00b7Bea",
    home_team_id: "101",
    away_team_id: "102",
    betradar_id: "555",
    tournament_id: 7,
    category_id: 2,
    utc_date: "2026-10-25T08:00:00Z",
    offer_state_status: { 2: 1 },
  },
  inplay_stats_metadata: { status: "STARTED" },
  inplay_stats: {
    home_team_score: "0",
    away_team_score: "1",
    home_team_game_score: "40",
    away_team_game_score: "A",
    team_serving: 2,
    periods: [
      { num: 1, type: 4, home_team_score: "4", away_team_score: "6" },
      { num: 2, type: 4, home_team_score: "2", away_team_score: "1" },
    ],
  },
  is_full_market_update: true,
  markets,
  superbets: [],
  priceboosts: [],
  ...extra,
});
function project(base = snapshot()) {
  const view = new SuperbetTennisProjection();
  view.install(base, 1234);
  return view.getSnapshot(base.event_id);
}
function fixture() {
  const messages = [];
  const view = new SuperbetTennisProjection({
    onSnapshot: (value) => messages.push({ kind: "snapshot", value }),
    onUpdate: (value) => messages.push(value),
  });
  const store = new SuperbetStore(8, {
    onSnapshot: (value) => view.install(value),
    onUpdate: (change) =>
      view.update(store.getSnapshot(change.event_id), change),
    onStale: (id) => view.invalidate(id),
    onRemove: (id) => view.remove(id),
  });
  const base = snapshot();
  store.add(base);
  store.install(base);
  return { messages, view, store };
}

test("the approved catalog has fixed binary roles and excludes reduced multiway, combined, boosted, and one-sided types", () => {
  assert.equal(superbetTennisMarkets.length, 48);
  assert.equal(new Set(superbetTennisMarkets.map((d) => d.id)).size, 48);
  for (const id of [
    515, 517, 521, 525, 526, 527, 528, 994, 997, 998, 200503, 200779, 201014,
    237052, 238826, 240897, 240903,
  ])
    assert.equal(
      superbetTennisMarkets.some((d) => d.id === id),
      false,
      `Excluded type ${id}`,
    );
  for (const definition of superbetTennisMarkets) {
    assert.equal(definition.outcomes.length, 2);
    assert.notEqual(definition.outcomes[0].id, definition.outcomes[1].id);
    assert.notEqual(definition.outcomes[0].role, definition.outcomes[1].role);
  }
});

test("independent captured vendor examples cover every approved ID in prematch or live", () => {
  assert.equal(samples.cases.length, 48);
  const covered = new Set();
  for (const sample of samples.cases) {
    const phase = sample.phase === "STARTED" ? 2 : 1;
    const base = snapshot([sample.market], {
      event_id: sample.eventId,
      fixture: {
        sport_id: 2,
        event_name: sample.eventName,
        offer_state_status: { [phase]: 1 },
      },
      inplay_stats_metadata: { status: sample.phase },
    });
    const value = project(base);
    assert.equal(
      value.lines.length,
      1,
      `${sample.market.id}: ${sample.market.name}`,
    );
    assert.equal(value.lines[0].selections.length, 2);
    assert.equal(value.lines[0].offerStateId, phase);
    covered.add(value.lines[0].marketId);
  }
  assert.deepEqual(
    [...covered].sort((a, b) => a - b),
    superbetTennisMarkets.map((d) => d.id),
  );
});

test("tennis context preserves set scores, point notation, server, identity and immutable snapshots", () => {
  const result = project();
  assert.equal(result.event.player1Sets, 0);
  assert.equal(result.event.player2Sets, 1);
  assert.equal(result.event.player1Points, "40");
  assert.equal(result.event.player2Points, "A");
  assert.equal(result.event.serving, "player2");
  assert.equal(result.event.sets[1].number, 2);
  assert.deepEqual(result.event.sets[1], {
    number: 2,
    player1Games: 2,
    player2Games: 1,
    sourceType: 4,
  });
  assert.equal(result.event.betradarId, 555);
  assert.equal(result.projectedAt, 1234);
  const base = snapshot();
  base.inplay_stats.home_team_game_score = "10";
  assert.equal(project(base).event.player1Points, "10");
  base.inplay_stats.periods.push({ ...base.inplay_stats.periods[0] });
  assert.deepEqual(project(base).event.sets, []);
  base.fixture.betradar_id = "0555";
  base.fixture.unix_date_millis = 0;
  const unknown = project(base).event;
  assert.equal(unknown.betradarId, null);
  assert.equal(unknown.startsAt, null);
});

test("cardinality is checked per line including hidden and suspended members", () => {
  const market = total();
  market.odds[1].status = 2;
  let value = project(snapshot([market]));
  assert.equal(value.lines.length, 1);
  assert.equal(value.lines[0].selections[1].status, 2);
  market.odds[1].display = false;
  assert.equal(project(snapshot([market])).lines.length, 0);
  market.odds[1].display = true;
  market.odds.push({
    ...market.odds[0],
    uuid: "third",
    display: false,
    status: 2,
  });
  assert.equal(project(snapshot([market])).lines.length, 0);
  market.odds.pop();
  market.odds.pop();
  assert.equal(project(snapshot([market])).lines.length, 0);
});

test("wrong names, outcome IDs, labels, parameter membership, or mismatched thresholds fail closed", () => {
  const cases = [
    (m) => {
      m.name += " combined";
    },
    (m) => {
      m.odds[0].metadata.outcome_id = 999;
    },
    (m) => {
      m.odds[0].metadata.name = "Peste 20.5";
    },
    (m) => {
      m.odds[1].metadata.specifiers.total = "21.5";
    },
    (m) => {
      m.odds[0].metadata.specifiers.extra = "1";
    },
    (m) => {
      m.odds[0].metadata.specifiers.total = "020.5";
    },
    (m) => {
      m.odds[0].metadata.specifiers.total = "-1";
    },
    (m) => {
      m.odds[0].metadata.specifiers.total = 20.5;
    },
    (m) => {
      m.odds[0].price = Infinity;
    },
    (m) => {
      m.odds[0].uuid = m.odds[1].uuid;
    },
  ];
  for (const alter of cases) {
    const market = total();
    alter(market);
    assert.equal(project(snapshot([market])).lines.length, 0, String(alter));
  }
});

test("prematch and live selections sharing an ID do not mix", () => {
  const market = total();
  const pre = structuredClone(market.odds);
  for (const odd of pre) {
    odd.uuid += "-pre";
    odd.metadata.offer_state_id = 1;
    odd.price = 2.2;
  }
  market.odds.push(...pre);
  const live = project(snapshot([market]));
  const prematch = project(
    snapshot([market], { inplay_stats_metadata: { status: "NOT_STARTED" } }),
  );
  assert.equal(live.lines.length, 1);
  assert.equal(prematch.lines.length, 1);
  assert.equal(prematch.lines[0].selections[0].price, 2.2);
  assert.notEqual(live.lines[0].key, prematch.lines[0].key);
});

test("set and game numbers come from structured parameters and invalid coordinates are rejected", () => {
  const sample = samples.cases.find((c) => c.market.id === 200504);
  const market = structuredClone(sample.market);
  const base = snapshot([market], {
    fixture: { sport_id: 2, event_name: sample.eventName },
  });
  const event = tennisEvent(base);
  const line = [...tennisLines(market, event).values()][0];
  assert.equal(
    line.setNumber,
    Number(market.odds[0].metadata.specifiers.setnr),
  );
  assert.equal(
    line.gameNumber,
    Number(market.odds[0].metadata.specifiers.gamenr),
  );
  for (const [key, value] of [
    ["setnr", "0"],
    ["setnr", "6"],
    ["gamenr", "1.5"],
    ["gamenr", "0"],
  ]) {
    const broken = structuredClone(market);
    for (const odd of broken.odds) odd.metadata.specifiers[key] = value;
    assert.equal(tennisLines(broken, event).size, 0);
  }
});

test("handicap signs are oriented to player1 and labels must identify the configured participant", () => {
  for (const sample of samples.cases.filter((c) =>
    [520, 1003, 200776, 235344].includes(c.market.id),
  )) {
    const market = structuredClone(sample.market);
    const event = tennisEvent(
      snapshot([market], {
        fixture: { sport_id: 2, event_name: sample.eventName },
        inplay_stats_metadata: { status: sample.phase },
      }),
    );
    const line = [...tennisLines(market, event).values()][0];
    assert.equal(line.selections[0].role, "player1");
    assert.equal(line.selections[1].role, "player2");
    assert.equal(line.selections[0].handicap, line.handicap);
    assert.equal(line.selections[1].handicap, -line.handicap);
    market.odds[1].metadata.name = market.odds[0].metadata.name;
    assert.equal(tennisLines(market, event).size, 0);
  }
});

test("ordered odds patches emit complete pairs while score and server changes emit context only", () => {
  const f = fixture();
  const old = f.view.getSnapshot(11);
  f.store.receive({
    event_id: 11,
    increment_id: 11,
    markets: [
      {
        id: 1002,
        name: "Total game-uri",
        odds: [{ uuid: "over", price: 2.1 }],
      },
    ],
  });
  assert.equal(f.messages.at(-1).upserts[0].selections[1].price, 2.1);
  assert.equal(old.lines[0].selections[1].price, 1.9);
  f.store.receive({
    event_id: 11,
    increment_id: 12,
    inplay_stats: {
      home_team_score: "0",
      away_team_score: "1",
      home_team_game_score: "0",
      away_team_game_score: "0",
      team_serving: 1,
      periods: [
        { num: 1, type: 4, home_team_score: "4", away_team_score: "6" },
        { num: 2, type: 4, home_team_score: "3", away_team_score: "1" },
      ],
    },
  });
  const changed = f.messages.at(-1);
  assert.equal(changed.event.serving, "player1");
  assert.equal(changed.event.sets[1].player1Games, 3);
  assert.deepEqual(changed.upserts, []);
  assert.equal(old.event.sets[1].player1Games, 2);
  const count = f.messages.length;
  f.store.receive({ event_id: 11, increment_id: 13 });
  assert.equal(f.messages.length, count);
  assert.equal(f.view.getSnapshot(11).sourceVersion, 13);
});

test("hidden selections and full empty offers remove lines", () => {
  const f = fixture();
  f.store.receive({
    event_id: 11,
    increment_id: 11,
    markets: [
      {
        id: 1002,
        name: "Total game-uri",
        odds: [{ uuid: "under", display: false }],
      },
    ],
  });
  assert.deepEqual(f.messages.at(-1).removed, ["1002:2:total"]);
  f.store.install({ ...snapshot(), increment_id: 12 });
  f.store.receive({
    event_id: 11,
    increment_id: 13,
    is_full_market_update: true,
    markets: [],
  });
  assert.deepEqual(f.view.getSnapshot(11).lines, []);
  assert.deepEqual(f.messages.at(-1).removed, ["1002:2:total"]);
});

test("gaps retain blocked identities, publish only after contiguous repair and remove ended events", () => {
  const f = fixture();
  f.store.receive({ event_id: 11, increment_id: 12 });
  assert.equal(f.messages.at(-1).kind, "invalidate");
  assert.equal(f.view.getSnapshot(11), null);
  assert.equal([...f.view.snapshots()][0].synchronized, false);
  assert.equal([...f.view.snapshots()][0].lines.length, 1);
  f.store.install({ ...snapshot(), increment_id: 11 });
  assert.equal(f.view.getSnapshot(11).sourceVersion, 12);
  assert.equal(f.messages.at(-1).kind, "snapshot");
  f.store.receive({
    event_id: 11,
    increment_id: 13,
    inplay_stats_metadata: { status: "FINISHED" },
  });
  assert.equal(f.messages.at(-1).kind, "remove");
  assert.equal(f.view.getSnapshot(11), null);
  assert.deepEqual([...f.view.snapshots()], []);
});

test("unsupported sports, invalid identities and ended offers never expose tennis lines", () => {
  for (const base of [
    snapshot([], { fixture: { sport_id: 5, event_name: "Alice\u00b7Bea" } }),
    snapshot([], { fixture: { sport_id: 2, event_name: "Only Alice" } }),
    snapshot([], { inplay_stats_metadata: { status: "FINISHED" } }),
    snapshot([], {
      fixture: {
        sport_id: 2,
        event_name: "Alice\u00b7Bea",
        offer_state_status: { 2: 2 },
      },
    }),
  ])
    assert.equal(project(base), null);
  const f = fixture();
  f.view.clear();
  assert.equal(f.messages.at(-1).kind, "remove");
  assert.equal(f.view.getSnapshot(11), null);
});
