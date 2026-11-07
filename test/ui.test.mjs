import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { UiController } from "../dist/ui/controller.js";
import { UiQuoteObserver } from "../dist/ui/observation/quotes.js";
import {
  betanoUiEvents,
  superbetUiEvents,
} from "../dist/ui/observation/events.js";
import { quoteView } from "../dist/ui/server/quotes.js";
import { pairedQuoteRows } from "../dist/ui/browser/paired-quotes.js";
import { footballMarketMapping } from "../dist/aggregation/mapping.config.js";
import { uiConfig } from "../dist/ui/config.js";
import { tick, until } from "./helpers/aggregation.mjs";
import { uiSnapshot, uiReport, uiStream } from "./helpers/ui.mjs";

const view = (provider, snapshot = uiSnapshot(provider), sport = "football") =>
  quoteView({
    provider,
    snapshot,
    sport,
    eventId: snapshot.event.id,
    at: 1,
    truncated: false,
  });

test("UI joins one canonical market/line and aligns outcomes independently of vendor order", () => {
  const betano = uiSnapshot("betano");
  betano.lines[0].selections.reverse();
  const left = view("superbet");
  const right = view("betano", betano);
  const paired = pairedQuoteRows({ superbet: left, betano: right });
  assert.equal(paired.length, 1);
  assert.equal(paired[0].market, "Total goluri");
  assert.equal(paired[0].superbet.selections[0].label, "Peste");
  assert.equal(paired[0].betano.selections[0].label, "Peste");
  assert.equal(paired[0].betano.selections[0].price, 2.1);
  assert.equal(pairedQuoteRows({ superbet: left }).length, 0);
  betano.lines[0].total = 3.5;
  assert.equal(
    pairedQuoteRows({ superbet: left, betano: view("betano", betano) }).length,
    0,
  );
  betano.lines[0].total = 2.5;
  betano.lines[0].marketTypeId = 999999;
  assert.equal(
    pairedQuoteRows({ superbet: left, betano: view("betano", betano) }).length,
    0,
  );
});

test("UI excludes ambiguous or incomplete sources and keeps suspension explicit", () => {
  const left = view("superbet");
  const betano = uiSnapshot("betano");
  betano.lines.push({ ...betano.lines[0], key: "duplicate-vendor-line" });
  assert.equal(
    pairedQuoteRows({ superbet: left, betano: view("betano", betano) }).length,
    0,
  );
  betano.lines.pop();
  betano.event.isSuspended = true;
  const right = view("betano", betano);
  assert.equal(
    pairedQuoteRows({ superbet: left, betano: right })[0].betano.selections[0]
      .available,
    false,
  );
  assert.equal(
    pairedQuoteRows({
      superbet: left,
      betano: { ...right, synchronized: false },
    }).length,
    0,
  );
  assert.equal(
    pairedQuoteRows({ superbet: left, betano: { ...right, truncated: true } })
      .length,
    0,
  );
  const truncated = quoteView({
    provider: "betano",
    snapshot: betano,
    sport: "football",
    eventId: 101,
    at: 1,
    truncated: true,
  });
  assert.ok(truncated.rows.every((row) => row.canonicalKey === null));
});

test("UI reuses fixed-threshold mapping instead of matching vendor labels", () => {
  const mapping = footballMarketMapping.find(
    (row) => row.threshold !== undefined && row.enabled !== false,
  );
  assert.ok(mapping);
  const left = uiSnapshot("superbet");
  left.lines[0].marketId = mapping.superbet;
  left.lines[0].total = mapping.threshold;
  const right = uiSnapshot("betano");
  right.lines[0].marketTypeId = mapping.betano;
  right.lines[0].total = null;
  right.lines[0].selections[0].role = "yes";
  right.lines[0].selections[1].role = "no";
  assert.equal(
    pairedQuoteRows({
      superbet: view("superbet", left),
      betano: view("betano", right),
    }).length,
    1,
  );
});

test("UI tennis pairing respects half-line handicaps, set coordinates, and game exclusions", () => {
  const snapshot = (
    provider,
    market,
    set = null,
    total = null,
    handicap = -2.5,
  ) => {
    const result = uiSnapshot(provider);
    result.event = {
      id: 101,
      phase: "live",
      player1: { name: "Player 1" },
      player2: { name: "Player 2" },
      player1Sets: 0,
      player2Sets: 0,
      player1Points: "0",
      player2Points: "0",
      serving: "player1",
      ...(provider === "superbet"
        ? { offerStatus: 1 }
        : { isSuspended: false }),
    };
    Object.assign(result.lines[0], {
      marketId: market,
      marketTypeId: market,
      setNumber: set,
      gameNumber: null,
      total,
      handicap,
    });
    return result;
  };
  const pair = (left, right) =>
    pairedQuoteRows({
      superbet: view("superbet", left, "tennis"),
      betano: view("betano", right, "tennis"),
    });
  const left = snapshot("superbet", 520);
  const right = snapshot("betano", 162);
  assert.equal(pair(left, right).length, 1);
  right.lines[0].handicap = -2;
  assert.equal(pair(left, right).length, 0);
  const setLeft = snapshot("superbet", 524, 1, 9.5, null);
  const setRight = snapshot("betano", 1512, 2, 9.5, null);
  assert.equal(pair(setLeft, setRight).length, 0);
  setRight.lines[0].setNumber = 1;
  assert.equal(pair(setLeft, setRight).length, 1);
  setRight.lines[0].gameNumber = 1;
  assert.equal(pair(setLeft, setRight).length, 0);
});

test("UI observer stays idle, limits pending messages, and publishes only the selected event", async (t) => {
  let reads = 0;
  let snapshot = uiSnapshot();
  const sent = [];
  const observer = new UiQuoteObserver(
    "betano",
    () => {
      reads++;
      return snapshot;
    },
    (value) => sent.push(value),
    10,
    1,
  );
  t.after(() => observer.close());
  await tick(20);
  assert.equal(reads, 0);
  observer.select({
    type: "ui-watch",
    generation: 1,
    sport: "football",
    eventId: 101,
  });
  assert.equal(sent.length, 1);
  snapshot = { ...snapshot, sourceVersion: 2, projectedAt: 2 };
  observer.changed("football", 101);
  await tick(30);
  assert.equal(
    reads,
    1,
    "A stalled consumer cannot accumulate cloned snapshots.",
  );
  observer.acknowledge();
  await until(() => sent.length === 2);
  observer.acknowledge();
  observer.changed("football", 999);
  observer.changed("tennis", 101);
  await tick(25);
  assert.equal(reads, 2);
  snapshot = null;
  observer.changed("football", 101);
  await until(() => sent.length === 3);
  assert.equal(
    sent[2].snapshot,
    null,
    "Unavailable sources clear displayed prices.",
  );
  observer.acknowledge();
  observer.select({
    type: "ui-watch",
    generation: 2,
    sport: "football",
    eventId: null,
  });
  observer.changed("football", 101);
  await tick(20);
  assert.equal(reads, 3);
});

test("UI observer bounds line copies and switches generation without an old backlog", () => {
  const snapshot = uiSnapshot();
  snapshot.lines.push({ ...snapshot.lines[0], key: "another" });
  const sent = [];
  const observer = new UiQuoteObserver(
    "betano",
    () => snapshot,
    (value) => sent.push(value),
    1000,
    1,
  );
  try {
    observer.select({
      type: "ui-watch",
      generation: 1,
      sport: "football",
      eventId: 101,
    });
    assert.equal(sent[0].truncated, true);
    assert.equal(sent[0].snapshot.lines.length, 1);
    assert.equal(
      snapshot.lines.length,
      2,
      "Diagnostics never mutate the source projection.",
    );
    observer.select({
      type: "ui-watch",
      generation: 2,
      sport: "football",
      eventId: 102,
    });
    assert.equal(sent.length, 1);
    observer.acknowledge();
    observer.select({
      type: "ui-watch",
      generation: 3,
      sport: "football",
      eventId: 103,
    });
    assert.equal(sent[1].generation, 3);
    assert.equal(sent[1].eventId, 103);
  } finally {
    observer.close();
  }
});

test("UI formatting preserves suspension and exposes only reduced public identities", () => {
  assert.deepEqual(
    superbetUiEvents([
      { id: 1, sportId: 5, name: "A - B" },
      { id: 2, sportId: 4, name: "C - D" },
    ]).map((event) => event.sport),
    ["football", "basketball"],
  );
  assert.equal(
    betanoUiEvents([
      {
        id: 1,
        sportId: "TENN",
        participants: [{ name: "A" }, { name: "B" }],
        secret: "private",
      },
    ])[0].name,
    "A - B",
  );
  assert.equal(
    "secret" in
      betanoUiEvents([{ id: 1, sportId: "TENN", secret: "private" }])[0],
    false,
  );
  for (const provider of ["betano", "superbet"]) {
    const snapshot = uiSnapshot(provider);
    const message = {
      provider,
      eventId: 101,
      sport: "football",
      at: 1,
      snapshot,
    };
    assert.equal(quoteView(message).rows[0].selections[0].available, true);
    if (provider === "betano") snapshot.event.isSuspended = true;
    else snapshot.event.offerStatus = 0;
    assert.equal(quoteView(message).rows[0].selections[0].available, false);
    assert.equal(quoteView({ ...message, snapshot: null }).rows.length, 0);
  }
});

test("UI process serves read-only assets, bounded history, and rejects stale or forged watches", async (t) => {
  const ui = new UiController({
    ...uiConfig,
    port: 0,
    summaryIntervalMs: 10,
    quoteIntervalMs: 10,
    historyLimit: 3,
  });
  const abort = new AbortController();
  t.after(async () => {
    abort.abort();
    await ui.stop();
  });
  const commands = [];
  ui.attach({
    betano: {
      watchUi(command) {
        commands.push(command);
      },
    },
  });
  ui.events("betano", [
    { provider: "betano", sport: "football", id: 101, name: "Home - Away" },
  ]);
  for (let i = 1; i <= 5; i++) ui.opportunity(uiReport("update", i));
  const url = await ui.start();
  assert.ok(url);
  const html = await fetch(url);
  assert.match(await html.text(), /Live observatory/);
  assert.match(
    html.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal((await fetch(`${url}/app.js`)).status, 200);
  assert.equal(
    (await fetch(`${url}/api/place`, { method: "POST" })).status,
    405,
  );
  const stream = await uiStream(url, abort.signal);
  const initial = await stream.next((data) => data.type === "snapshot");
  const overview = await stream.next((data) => data.summary !== undefined);
  assert.equal(overview.summary.counts.betano.football, 1);
  assert.equal(overview.dropped, 2);
  assert.deepEqual(
    overview.opportunities.map((report) => report.id),
    [3, 4, 5],
  );
  const watch = (selection, headers = {}) =>
    fetch(`${url}/api/watch`, {
      method: "POST",
      headers: { Origin: url, "X-UI-Client": initial.clientId, ...headers },
      body: JSON.stringify(selection),
    });
  assert.equal((await watch({ sport: "football", betano: 999 })).status, 400);
  assert.equal(
    (
      await watch(
        { sport: "football", betano: 101 },
        { Origin: "https://other.invalid" },
      )
    ).status,
    403,
  );
  assert.equal((await watch({ sport: "football", betano: 101 })).status, 204);
  await until(() => commands.some((command) => command.eventId === 101));
  const generation = commands.at(-1).generation;
  ui.quote({
    type: "ui-quotes",
    provider: "betano",
    generation,
    sport: "football",
    eventId: 101,
    at: Date.now(),
    snapshot: uiSnapshot(),
    truncated: false,
  });
  const data = await stream.next(
    (data) => data.quotes?.betano?.rows?.length === 1,
  );
  assert.equal(data.quotes.betano.rows[0].selections[0].price, 2.1);
  assert.equal((await watch(null)).status, 204);
  await until(() => commands.at(-1).eventId === null);
  ui.quote({
    type: "ui-quotes",
    provider: "betano",
    generation,
    sport: "football",
    eventId: 101,
    at: Date.now(),
    snapshot: uiSnapshot(),
    truncated: false,
  });
  const cleared = await stream.next(
    (data) => data.selection === null && data.type === "update",
  );
  assert.deepEqual(cleared.quotes, {});
  assert.equal(ui.quotes.size, 0);
  ui.remove("betano", 101);
  const removed = await stream.next(
    (data) => data.summary?.counts.betano.football === 0,
  );
  assert.equal(removed.summary.events.betano.length, 0);
  abort.abort();
  await until(() => ui.viewers === false);
});

test("UI failure or disablement leaves source APIs independent", async (t) => {
  const disabled = new UiController({ ...uiConfig, enabled: false });
  assert.equal(await disabled.start(), null);
  assert.equal(disabled.child, null);
  const occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  t.after(() => occupied.close());
  const ui = new UiController({ ...uiConfig, port: occupied.address().port });
  t.after(() => ui.stop());
  assert.equal(await ui.start(), null);
  assert.equal(ui.child, null);
});

test("a stalled UI channel coalesces updates, bounds reports, and cancels observation", () => {
  const ui = new UiController({ ...uiConfig, historyLimit: 2 });
  const commands = [];
  ui.attach({
    betano: {
      watchUi(command) {
        commands.push(command);
      },
    },
  });
  ui.viewers = true;
  ui.select({ sport: "football", betano: 101 });
  const generation = ui.generation;
  for (let version = 1; version <= 100; version++) {
    ui.quote({
      type: "ui-quotes",
      provider: "betano",
      generation,
      sport: "football",
      eventId: 101,
      at: Date.now(),
      snapshot: uiSnapshot("betano", 101, version),
      truncated: false,
    });
    ui.opportunity(uiReport("update", version));
  }
  assert.equal(ui.quotes.size, 1);
  assert.equal(ui.quotes.get("betano").snapshot.sourceVersion, 100);
  assert.equal(ui.reports.length, 2);
  assert.equal(ui.dropped, 98);
  ui.inFlight = { sequence: 1, at: Date.now() - 6000 };
  ui.flush();
  assert.equal(ui.viewers, false);
  assert.equal(commands.at(-1).eventId, null);
});
