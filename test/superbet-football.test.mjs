import assert from "node:assert/strict";
import test from "node:test";
import { superbetFootballMarkets } from "../dist/providers/superbet/football-markets.config.js";
import { SuperbetFootballProjection } from "../dist/providers/superbet/processing/football-projection.js";
import { SuperbetStore } from "../dist/providers/superbet/processing/state.js";

const selection = (id, outcomeId, lineId, params = {}, extra = {}) => ({
  uuid: id,
  price: 1.9,
  status: 1,
  display: true,
  metadata: {
    outcome_id: outcomeId,
    market_line_uuid: lineId,
    offer_state_id: 2,
    ...(Object.keys(params).length ? { specifiers: params } : {}),
  },
  ...extra,
});
const total = (lineId = "goals-2.5", value = "2.5") => ({
  id: 200734,
  name: "Total goluri",
  odds: [
    selection(`${lineId}-under`, 151888, lineId, { total: value }),
    selection(`${lineId}-over`, 151889, lineId, { total: value }),
  ],
});
const snapshot = (markets = [total()], extra = {}) => ({
  event_id: 11,
  increment_id: 10,
  fixture: {
    sport_id: 5,
    event_name: "Home\u00b7Away",
    home_team_id: "101",
    away_team_id: "102",
    tournament_id: 106,
    category_id: 45,
    utc_date: "2026-10-24T14:00:00Z",
    offer_state_status: { 2: 1 },
  },
  inplay_stats_metadata: { status: "STARTED", event_status_label: "1H" },
  inplay_stats: { home_team_score: "0", away_team_score: "0", minutes: "10" },
  is_full_market_update: true,
  markets,
  superbets: [],
  priceboosts: [],
  ...extra,
});
function project(markets, extra = {}) {
  const view = new SuperbetFootballProjection();
  view.install(snapshot(markets, extra), 1234);
  return view.getSnapshot(11);
}
function synchronized() {
  const messages = [];
  const view = new SuperbetFootballProjection({
    onSnapshot: (value) => messages.push({ kind: "snapshot", value }),
    onUpdate: (value) => messages.push(value),
  });
  const store = new SuperbetStore(8, {
    onSnapshot: (value) => view.install(value),
    onUpdate: (change) =>
      view.update(store.getSnapshot(change.event_id), change),
    onStale: (id) => view.remove(id),
    onRemove: (id) => view.remove(id),
  });
  const base = snapshot();
  store.add(base);
  store.install(base);
  return { view, store, messages };
}

test("catalog contains explicit pairs and excludes three-way, combined, player, and one-sided types", () => {
  assert.equal(
    new Set(superbetFootballMarkets.map((rule) => rule.id)).size,
    superbetFootballMarkets.length,
  );
  for (const id of [
    546, 553, 551, 547, 532, 200571, 201503, 237085, 240046, 239157,
  ])
    assert.equal(
      superbetFootballMarkets.some((rule) => rule.id === id),
      false,
      `excluded type ${id}`,
    );
  for (const rule of superbetFootballMarkets) {
    assert.equal(rule.outcomes.length, 2);
    assert.notEqual(rule.outcomes[0].id, rule.outcomes[1].id);
    assert.notEqual(rule.outcomes[0].role, rule.outcomes[1].role);
  }
});

test("cardinality belongs to each line; one- and three-member lines are rejected without truncation", () => {
  const market = total();
  market.odds.push(...total("goals-3.5", "3.5").odds);
  market.odds.push(selection("single", 151889, "single", { total: "4.5" }));
  market.odds.push(
    ...total("triple", "5.5").odds,
    selection(
      "third",
      999999,
      "triple",
      { total: "5.5" },
      { status: 2, display: false },
    ),
  );
  const view = project([market]);
  assert.deepEqual(
    view.lines.map((line) => line.total),
    [2.5, 3.5],
  );
  assert.ok(view.lines.every((line) => line.selections.length === 2));
});

test("two active outcomes cannot promote a European handicap into the catalog", () => {
  const market = {
    id: 546,
    name: "Handicap european",
    odds: [
      selection("home", 1467, "european", { hcp: "0:1" }),
      selection("draw", 1468, "european", { hcp: "0:1" }, { display: false }),
      selection("away", 1469, "european", { hcp: "0:1" }),
    ],
  };
  assert.deepEqual(project([market]).lines, []);
});

test("known outcome IDs map roles independently of order or display labels", () => {
  const market = total();
  market.odds.reverse();
  market.odds[0].metadata.name = "Untrusted display text";
  const line = project([market]).lines[0];
  assert.deepEqual(
    line.selections.map((odd) => odd.role),
    ["under", "over"],
  );
  for (const invalid of [
    [market.odds[0], { ...market.odds[0], uuid: "another-over" }],
    [market.odds[0], { ...market.odds[1], uuid: market.odds[0].uuid }],
  ])
    assert.deepEqual(project([{ ...market, odds: invalid }]).lines, []);
});

test("unknown IDs, altered exact names, and unsupported structured parameters are excluded", () => {
  assert.deepEqual(project([{ ...total(), id: 999999 }]).lines, []);
  assert.deepEqual(
    project([{ ...total(), name: "Total goluri & GG" }]).lines,
    [],
  );
  for (const params of [
    {},
    { total: "2.5", player: "123" },
    { total: 2.5 },
    { total: "2.5-extra" },
  ]) {
    const market = total();
    for (const odd of market.odds) odd.metadata.specifiers = params;
    assert.deepEqual(project([market]).lines, []);
  }
  const market = total();
  market.odds[1].metadata.specifiers.total = "3.5";
  assert.deepEqual(project([market]).lines, []);
});

test("handicap signs are selection-specific and zero survives normalization", () => {
  const handicap = (value) => ({
    id: 530,
    name: "Handicap asiatic",
    odds: [
      selection("home", 1361, "handicap", { hcp: value }),
      selection("away", 1362, "handicap", { hcp: value }),
    ],
  });
  const line = project([handicap("-1.25")]).lines[0];
  assert.equal(line.handicap, -1.25);
  assert.deepEqual(
    line.selections.map((odd) => odd.handicap),
    [-1.25, 1.25],
  );
  const zero = project([handicap("-0")]).lines[0];
  assert.equal(zero.handicap, 0);
  assert.ok(zero.selections.every((odd) => Object.is(odd.handicap, 0)));
  assert.deepEqual(project([handicap("0:1")]).lines, []);
});

test("team templates substitute literal names; a player name cannot replace a team", () => {
  const market = {
    id: 544,
    name: "Total goluri A$&",
    odds: [
      selection("under", 1461, "home-total", { total: "0.5" }),
      selection("over", 1462, "home-total", { total: "0.5" }),
    ],
  };
  const fixture = { ...snapshot().fixture, event_name: "A$&\u00b7Away" };
  assert.equal(project([market], { fixture }).lines.length, 1);
  assert.equal(
    project([{ ...market, name: "Total goluri Named Player" }], { fixture })
      .lines.length,
    0,
  );
});

test("suspended selections remain in a complete pair; hidden members remove the whole line", () => {
  const market = total();
  market.odds[0].status = 2;
  market.odds[0].price = 0;
  assert.equal(project([market]).lines[0].selections[0].status, 2);
  assert.equal(project([market]).lines[0].selections[0].price, 0);
  market.odds[0].display = false;
  assert.deepEqual(project([market]).lines, []);
});

test("prematch and live pairs never mix, including quotes sharing a line ID", () => {
  const market = total();
  const prematch = structuredClone(market.odds);
  for (const odd of prematch) {
    odd.uuid += "-prematch";
    odd.price = 2.1;
    odd.metadata.offer_state_id = 1;
  }
  market.odds.push(...prematch);
  assert.equal(project([market]).lines[0].offerStateId, 2);
  const before = project([market], {
    inplay_stats_metadata: { status: "NOT_STARTED" },
    fixture: { ...snapshot().fixture, offer_state_status: { 1: 1 } },
  });
  assert.equal(before.lines[0].offerStateId, 1);
  assert.equal(before.lines[0].selections[0].price, 2.1);
});

test("interval names, structured bounds, duration, and first-minutes parameters must agree", () => {
  const market = {
    id: 693,
    name: "Următoarele 10 minute - Total goluri de la 30:00 la 39:59",
    odds: [
      selection("under", 2017, "interval", {
        from: "30",
        to: "39",
        total: "0.5",
      }),
      selection("over", 2018, "interval", {
        from: "30",
        to: "39",
        total: "0.5",
      }),
    ],
  };
  const line = project([market]).lines[0];
  assert.equal(line.fromMinute, 30);
  assert.equal(line.toMinute, 39);
  assert.deepEqual(
    project([{ ...market, name: market.name.replace("39:59", "49:59") }]).lines,
    [],
  );
  for (const odd of market.odds) odd.metadata.specifiers.to = "40";
  assert.deepEqual(project([market]).lines, []);
  const first = {
    id: 200248,
    name: "Total goluri în primele X minute",
    odds: [
      selection("under", 100236, "first-minutes", { total: "0.5", xnr: "35" }),
      selection("over", 100235, "first-minutes", { total: "0.5", xnr: "35" }),
    ],
  };
  assert.equal(project([first]).lines[0].firstMinutes, 35);
});

test("a type offering both yes and no can still contain an incomplete threshold", () => {
  const market = {
    id: 231045,
    name: "Fiecare echipă va primi peste X cartonașe",
    odds: [
      selection("yes", 4204536, "cards-0.5", { total: "0.5" }),
      selection("no", 4204537, "cards-0.5", { total: "0.5" }),
      selection("only-yes", 4204536, "cards-1.5", { total: "1.5" }),
    ],
  };
  const lines = project([market]).lines;
  assert.equal(lines.length, 1);
  assert.equal(lines[0].total, 0.5);
  assert.deepEqual(
    lines[0].selections.map((odd) => odd.role),
    ["yes", "no"],
  );
});

test("accepted partial price changes emit a complete pair and unrelated changes emit nothing", () => {
  const { store, view, messages } = synchronized();
  store.receive({
    event_id: 11,
    increment_id: 11,
    markets: [
      {
        id: 200734,
        name: "Total goluri",
        odds: [{ uuid: "goals-2.5-over", price: 2.2 }],
      },
    ],
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].kind, "update");
  assert.equal(messages[1].upserts.length, 1);
  assert.equal(messages[1].upserts[0].selections.length, 2);
  assert.equal(messages[1].upserts[0].selections[1].price, 2.2);
  assert.equal(messages[1].event, undefined);
  store.receive({ event_id: 11, increment_id: 12, priceboosts: [] });
  assert.equal(messages.length, 2);
  assert.equal(view.getSnapshot(11).sourceVersion, 12);
});

test("removing one selection deletes the pair; a full replacement reports all missing lines", () => {
  const { store, view, messages } = synchronized();
  const key = view.getSnapshot(11).lines[0].key;
  store.receive({
    event_id: 11,
    increment_id: 11,
    markets: [
      {
        id: 200734,
        name: "Total goluri",
        odds: [{ uuid: "goals-2.5-under", display: false }],
      },
    ],
  });
  assert.deepEqual(messages[1].removed, [key]);
  assert.deepEqual(view.getSnapshot(11).lines, []);
  store.receive({ ...snapshot([total("new", "3.5")]), increment_id: 12 });
  assert.equal(view.getSnapshot(11).lines[0].total, 3.5);
  store.receive({
    event_id: 11,
    increment_id: 13,
    is_full_market_update: true,
    markets: [],
  });
  assert.equal(messages.at(-1).removed.length, 1);
  assert.deepEqual(view.getSnapshot(11).lines, []);
});

test("score changes propagate event context without resending unchanged odds", () => {
  const { store, messages } = synchronized();
  store.receive({
    event_id: 11,
    increment_id: 11,
    inplay_stats: { home_team_score: "1", away_team_score: "0", minutes: "20" },
  });
  assert.equal(messages[1].event.homeScore, "1");
  assert.deepEqual(messages[1].upserts, []);
});

test("version gaps invalidate the filtered view and repair publishes the replayed baseline", () => {
  const { store, view, messages } = synchronized();
  store.receive({
    event_id: 11,
    increment_id: 12,
    markets: [
      {
        id: 200734,
        name: "Total goluri",
        odds: [{ uuid: "goals-2.5-over", price: 2.4 }],
      },
    ],
  });
  assert.equal(view.getSnapshot(11), null);
  assert.equal(messages.at(-1).kind, "invalidate");
  store.install({ ...snapshot(), increment_id: 11 });
  assert.equal(messages.at(-1).kind, "snapshot");
  assert.equal(view.getSnapshot(11).sourceVersion, 12);
  assert.equal(view.getSnapshot(11).lines[0].selections[1].price, 2.4);
  store.receive({ event_id: 11, increment_id: 11 });
  assert.equal(view.getSnapshot(11).sourceVersion, 12);
});

test("ended events and invalid event metadata invalidate previously published data", () => {
  const { store, view, messages } = synchronized();
  store.receive({
    event_id: 11,
    increment_id: 11,
    inplay_stats_metadata: { status: "FINISHED" },
  });
  assert.equal(view.getSnapshot(11), null);
  assert.equal(messages.at(-1).kind, "invalidate");
  view.install(snapshot());
  view.update(
    snapshot([], {
      increment_id: 12,
      fixture: { sport_id: 5, event_name: "Incomplete" },
    }),
    {
      event_id: 11,
      increment_id: 12,
      fixture: { sport_id: 5, event_name: "Incomplete" },
    },
  );
  assert.equal(view.getSnapshot(11), null);
  assert.equal(messages.at(-1).kind, "invalidate");
});

test("the Betradar ID and start time are validated before aggregation uses them", () => {
  const event = (fixture) =>
    project([total()], { fixture: { ...snapshot().fixture, ...fixture } }).event;
  assert.equal(event({ betradar_id: "72530980" }).betradarId, 72_530_980);
  for (const invalid of [undefined, "", "0", "07", "12a", 72530980, "9".repeat(17)])
    assert.equal(event({ betradar_id: invalid }).betradarId, null, String(invalid));
  const start = Date.parse("2026-10-24T14:00:00Z");
  assert.equal(
    event({ unix_date_millis: start }).startsAt,
    "2026-10-24T14:00:00.000Z",
  );
  // Two disagreeing start fields leave the start unknown rather than picking one.
  assert.equal(event({ unix_date_millis: start + 60_000 }).startsAt, null);
});
