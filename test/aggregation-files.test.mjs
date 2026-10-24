import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LearnedTables } from "../dist/aggregation/matching/learning.js";
import { normalizeTeam } from "../dist/aggregation/matching/names.js";
import { JsonlRecorder } from "../dist/aggregation/processing/recorder.js";

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "aggregation-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

const pair = (superbet, betano, competitions = [7, 70]) => ({
  superbet: {
    home: normalizeTeam(superbet),
    away: normalizeTeam("Rapid"),
    identity: { competitionId: competitions[0] },
  },
  betano: {
    home: normalizeTeam(betano),
    away: normalizeTeam("Rapid"),
    identity: { competitionId: competitions[1] },
  },
});

test("learned tables survive a save and load round trip", async (t) => {
  const path = join(await directory(t), "learned.json");
  const tables = new LearnedTables(path, (error) => assert.fail(error));
  tables.learn(pair("FCSB", "Steaua București"));
  await tables.save();
  const loaded = new LearnedTables(path, (error) => assert.fail(error));
  await loaded.load();
  assert.deepEqual(loaded.sizes, { aliases: 1, competitions: 1 });
  assert.ok(loaded.aliases.get("fcsb").has("steaua bucuresti"));
  assert.ok(loaded.aliases.get("steaua bucuresti").has("fcsb"));
  assert.equal(loaded.competition(7), 70);
});

test("contradicting competitions and different squads are never learned", async () => {
  const tables = new LearnedTables(null, (error) => assert.fail(error));
  tables.learn(pair("Atenas U21", "Atenas LDD"));
  assert.deepEqual(tables.sizes, { aliases: 0, competitions: 0 });
  tables.learn(pair("Steaua", "Steaua", [7, 70]));
  tables.learn(pair("Steaua", "Steaua", [7, 71]));
  assert.equal(tables.competition(7), undefined);
  tables.learn(pair("Steaua", "Steaua", [7, 70]));
  assert.equal(tables.competition(7), undefined);
});

test("an invalid tables file is reported and ignored", async (t) => {
  const path = join(await directory(t), "learned.json");
  const errors = [];
  for (const content of [
    "not json",
    JSON.stringify({ version: 2, aliases: [], competitions: [] }),
    JSON.stringify({ version: 1, aliases: [["same", "same"]], competitions: [] }),
    JSON.stringify({ version: 1, aliases: [], competitions: [[1, -2]] }),
  ]) {
    await writeFile(path, content);
    const tables = new LearnedTables(path, (error) => errors.push(error));
    await tables.load();
    assert.deepEqual(tables.sizes, { aliases: 0, competitions: 0 });
  }
  assert.equal(errors.length, 4);
  const missing = new LearnedTables(join(path, "..", "missing.json"), (error) =>
    assert.fail(error),
  );
  await missing.load();
});

test("the recorder appends one JSON object per line", async (t) => {
  const path = join(await directory(t), "opportunities.jsonl");
  const recorder = new JsonlRecorder(path, 100, (error) => assert.fail(error));
  for (let id = 1; id <= 3; id++) recorder.write({ id, kind: "open" });
  await recorder.close();
  const lines = (await readFile(path, "utf8")).trim().split("\n");
  assert.deepEqual(lines.map((line) => JSON.parse(line).id), [1, 2, 3]);
  const disabled = new JsonlRecorder(null, 100, (error) => assert.fail(error));
  disabled.write({ id: 4 });
  assert.deepEqual(disabled.getStats(), { written: 0, queued: 0, dropped: 0 });
  await disabled.close();
});
