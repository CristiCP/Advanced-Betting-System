import assert from "node:assert/strict";
import test from "node:test";
import { footballLineKey } from "../dist/aggregation/adapter/football.js";
import { aggregationConfig } from "../dist/aggregation/config.js";
import { footballMarketMapping } from "../dist/aggregation/mapping.config.js";
import { mappingIndex, validateMapping } from "../dist/aggregation/mapping.js";
import { lineCode, lineKey, lineQuarters } from "../dist/aggregation/protocol/wire.js";
import { betanoFootballMarkets } from "../dist/providers/betano/football-markets.config.js";
import { superbetFootballMarkets } from "../dist/providers/superbet/football-markets.config.js";

const superbet = new Map(superbetFootballMarkets.map((d) => [d.id, d]));
const betano = new Map(betanoFootballMarkets.map((d) => [d.typeId, d]));
const row = (code) => footballMarketMapping.find((entry) => entry.code === code);

test("every mapping row agrees with both provider catalogs", () => {
  assert.equal(footballMarketMapping.length, 80);
  assert.deepEqual(validateMapping(footballMarketMapping, superbet, betano), []);
});

test("inconsistent rows are reported instead of silently mapped", () => {
  const goals = row(1);
  const broken = [
    goals,
    { ...goals },
    { ...goals, code: 4096, betano: 15 },
    { ...goals, code: 300, conditions: ["T"] },
    { ...goals, code: 301, superbet: 539 },
    { ...goals, code: 302, betano: 999_999 },
    { ...goals, code: 303, conditions: ["D", "P"] },
  ];
  const errors = validateMapping(broken, superbet, betano);
  for (const expected of [
    /mapping 1 .*duplicate code/,
    /mapping 1 .*duplicate pair/,
    /mapping 4096 .*code must be/,
    /mapping 4096 .*market kinds differ/,
    /mapping 300 .*threshold is required/,
    /mapping 301 .*market kinds differ/,
    /mapping 302 .*missing from a catalog/,
    /mapping 303 .*invalid conditions/,
  ])
    assert.ok(errors.some((error) => expected.test(error)), String(expected));
});

test("only rows whose conditions are all enabled are indexed", () => {
  const index = mappingIndex("superbet", aggregationConfig.enabledConditions);
  const rows = [...index.values()].flat();
  assert.equal(rows.length, 73);
  assert.ok(rows.every((entry) => entry.conditions.every((c) => aggregationConfig.enabledConditions.includes(c))));
  // Statistics and each-team card thresholds are enabled; intervals and Asian rows stay excluded.
  for (const type of [704, 690, 201590, 200690, 200714, 230900, 230933])
    assert.ok(index.has(type), `Missing statistic market: ${type}`);
  assert.deepEqual(index.get(231045)?.map((entry) => entry.threshold), [0.5, 1.5]);
  assert.equal(index.has(729), false);
  assert.equal(index.has(711), false);
  assert.equal(index.has(529), false);
  assert.equal(index.has(530), false);
  const betanoIndex = mappingIndex("betano", aggregationConfig.enabledConditions);
  assert.equal([...betanoIndex.values()].flat().length, 73);
  for (const type of [34, 65, 4159, 4629, 351, 460, 643])
    assert.ok(betanoIndex.has(type), `Missing statistic market: ${type}`);
  assert.equal(betanoIndex.get(4151)?.[0].threshold, 0.5);
  assert.equal(mappingIndex("superbet", ["D", "T"]).has(231045), false);
  assert.equal(mappingIndex("betano", []).size, 0);
});

test("canonical line keys follow the threshold, the line, and the side", () => {
  const goals = row(1);
  const key = footballLineKey(goals, "total", "superbet", 2.5, null, 0);
  assert.deepEqual([lineCode(key), lineQuarters(key)], [1, 10]);
  assert.equal(footballLineKey(goals, "total", "betano", 2.5, null, 0), key);
  assert.equal(footballLineKey(goals, "total", "superbet", 2.4, null, 0), null);
  assert.equal(footballLineKey(goals, "total", "superbet", null, null, 0), null);
  const red = footballMarketMapping.find((entry) => entry.betano === 51);
  const yes = footballLineKey(red, "yes-no", "betano", null, null, 0);
  assert.equal(footballLineKey(red, "total", "superbet", 0.5, null, 0), yes);
  assert.equal(footballLineKey(red, "total", "superbet", 1.5, null, 0), null);
  assert.equal(footballLineKey(red, "yes-no", "betano", 0.5, null, 0), null);
  const handicap = row(35);
  assert.equal(
    footballLineKey(handicap, "asian-handicap", "superbet", null, -0.75, 0),
    lineKey(35, -3),
  );
  const both = footballMarketMapping.find((entry) => entry.betano === 15);
  assert.equal(
    footballLineKey(both, "yes-no", "superbet", null, null, 0),
    lineKey(both.code, 0),
  );
  assert.equal(footballLineKey(both, "yes-no", "superbet", 1.5, null, 0), null);
});
