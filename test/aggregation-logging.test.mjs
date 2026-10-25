import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { aggregationConsoleHandlers as handlers } from "../dist/aggregation/logging.js";

test("an initial summary is followed by minute summaries of currently comparable matches", (t) => {
  const lines = [];
  const tables = [];
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  t.mock.method(console, "log", (...args) => lines.push(args.join(" ")));
  t.mock.method(console, "table", (rows) => tables.push(rows));
  assert.equal(handlers.onMatches, undefined);
  const status = (football, tennis) => ({ kind: "stats", stats: {
    activeMatches: football,
    matching: { confirmed: 99 },
    sports: { football: { activeMatches: football }, tennis: { activeMatches: tennis } },
  } });
  handlers.onStatus(status(0, 0));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /initializare:/);
  assert.ok(!lines[0].includes("total=0"));
  now += 5_000;
  handlers.onStatus(status(0, 0));
  assert.equal(lines.length, 1);
  now += 5_000;
  handlers.onStatus(status(2, 1));
  assert.equal(lines[1], "[MATCHED ACTIVE] Superbet <-> Betano | total=3 | football=2 | tennis=1");
  now += 5_000;
  handlers.onStatus(status(3, 2));
  assert.equal(lines.length, 2);
  now += 55_000;
  handlers.onStatus(status(3, 2));
  assert.equal(lines[2], "[MATCHED ACTIVE] Superbet <-> Betano | total=5 | football=3 | tennis=2");
  now += 59_999;
  handlers.onStatus(status(0, 0));
  assert.equal(lines.length, 3);
  now++;
  handlers.onStatus(status(0, 0));
  assert.match(lines[3], /total=0 \| football=0 \| tennis=0/);
  assert.equal(tables.length, 0);
});

test("startup with no usable matches reports zero after a bounded wait", async (t) => {
  const { aggregationConsoleHandlers: fresh } = await import("../dist/aggregation/logging.js?empty-startup");
  let now = Date.now();
  const lines = [];
  t.mock.method(Date, "now", () => now);
  t.mock.method(console, "log", (line) => lines.push(line));
  const status = { kind: "stats", stats: { activeMatches: 0 } };
  fresh.onStatus(status);
  assert.match(lines[0], /initializare:/);
  now += 29_999;
  fresh.onStatus(status);
  assert.equal(lines.length, 1);
  now++;
  fresh.onStatus(status);
  assert.match(lines[1], /total=0 \| football=0 \| tennis=0/);
  now += 60_000;
  fresh.onStatus(status);
  assert.equal(lines.length, 3);
});

test("pause and resume logs distinguish last confirmed quotes and disclose the unconfirmed duration", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(stripVTControlCharacters(line)));
  const report = {
    kind: "pause", id: 7, at: 1_000, match: "Home - Away", score: "1-0", concept: "Total goals",
    line: 2.5, legs: [{ provider: "superbet", label: "over", price: 2.1 }, { provider: "betano", label: "under", price: 2.2 }],
    marginBps: 50, durationMs: 2_000, unconfirmedMs: 0, reasonDetail: "superbet: resincronizare",
  };
  handlers.onOpportunity(report);
  handlers.onOpportunity({ ...report, kind: "resume", unconfirmedMs: 1_250 });
  handlers.onOpportunity({ ...report, kind: "close", reason: "margin", unconfirmedMs: 1_250 });
  assert.match(lines[0], /PAUSED #7/);
  assert.match(lines[0], /ultimele cote confirmate; superbet: resincronizare/);
  assert.match(lines[1], /RESUMED #7/);
  assert.match(lines[1], /timp neconfirmat=1\.250s/);
  assert.match(lines[2], /CLOSED #7.*durata=2\.000s.*timp neconfirmat=1\.250s/);
});

test("closing colors use the reported margin with a strict 0.5% boundary for both sports", () => {
  const reports = [
    { kind: "close", marginBps: 100, reason: "margin" },
    { kind: "close", marginBps: 50.01, reason: "margin", sport: "tennis" },
    { kind: "close", marginBps: 50, reason: "margin" },
    { kind: "close", marginBps: 49.99, reason: "margin", sport: "tennis" },
    { kind: "close", marginBps: -10, reason: "margin" },
    { kind: "close", marginBps: 300, reason: "suspended" },
    { kind: "open", marginBps: 200 },
    { kind: "update", marginBps: 210 },
    { kind: "pause", marginBps: 210 },
    { kind: "resume", marginBps: 210 },
  ];
  const script = `
    import { aggregationConsoleHandlers } from ${JSON.stringify(new URL("../dist/aggregation/logging.js", import.meta.url).href)};
    for (const report of ${JSON.stringify(reports)}) {
      aggregationConsoleHandlers.onOpportunity({
        id: 1, at: 1000, match: "Home - Away", score: "0-0", concept: "Total",
        line: 2.5, legs: [{ provider: "superbet", label: "over", price: 2.1 }, { provider: "betano", label: "under", price: 2.2 }],
        durationMs: 2000, unconfirmedMs: 0, ...report,
      });
    }
  `;
  const env = { ...process.env, FORCE_COLOR: "1" };
  delete env.NO_COLOR;
  delete env.NODE_DISABLE_COLORS;
  const run = (colorEnv) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      env: colorEnv, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trimEnd().split(/\r?\n/);
  };
  const lines = run(env);
  const codes = [35, 35, 31, 31, 31, 35, 32, 34, 33, 34];
  assert.equal(lines.length, reports.length);
  for (let i = 0; i < lines.length; i++) {
    assert.ok(lines[i].startsWith(`\u001b[${codes[i]}m`), `Unexpected color for report ${i}: ${JSON.stringify(lines[i])}`);
    if (reports[i].kind === "close") assert.match(lines[i], /CLOSED #1.*durata=2\.000s.*motiv=/);
  }
  assert.match(lines[1], /\[TENNIS\]/);
  const noColorEnv = { ...env, NO_COLOR: "1" };
  delete noColorEnv.FORCE_COLOR;
  for (const line of run(noColorEnv)) assert.ok(!line.includes("\u001b["));
});
