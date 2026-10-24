import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTeam, teamSimilarity } from "../dist/aggregation/matching/names.js";

const similarity = (a, b, aliases) =>
  teamSimilarity(normalizeTeam(a), normalizeTeam(b), aliases);

test("accents, cedilla and comma letters, and Nordic letters fold to the same key", () => {
  assert.equal(normalizeTeam("Steaua București").key, "steaua bucuresti");
  assert.equal(normalizeTeam("Steaua Bucureşti").key, "steaua bucuresti");
  assert.equal(normalizeTeam("Stjarnan Garðabær").key, "stjarnan gardabaer");
  assert.equal(normalizeTeam("1. FC Köln").key, "1 koln");
  assert.equal(normalizeTeam("Asociación Deportiva").key, "asociacion deportiva");
});

test("squad markers are kept as attributes and never removed silently", () => {
  assert.equal(normalizeTeam("Atenas U21").markers, "u21");
  assert.equal(normalizeTeam("Atenas LDD").markers, "ldd");
  assert.equal(normalizeTeam("Atenas U21").key, normalizeTeam("Atenas LDD").key);
  assert.equal(normalizeTeam("Barcelona (F)").markers, "w");
  assert.equal(normalizeTeam("Real Madrid Femenino").markers, "w");
  assert.equal(normalizeTeam("Bayern Munchen II").markers, "ii");
  assert.equal(normalizeTeam("Jong Ajax Reserves").markers, "ii");
  assert.equal(normalizeTeam("Sporting B").markers, "ii");
  assert.equal(normalizeTeam("Benfica Sub-23").markers, "u23");
  // A leading B is part of the name, not a reserve marker.
  assert.equal(normalizeTeam("B 36 Torshavn").markers, "");
  assert.equal(normalizeTeam("Manchester City").markers, "");
});

test("similarity accepts common spellings and rejects different clubs", () => {
  assert.equal(similarity("FC Steaua București", "Steaua Bucureşti"), 1);
  assert.equal(similarity("PSG", "Paris Saint-Germain"), 0.9);
  assert.ok(similarity("Man Utd", "Manchester United") >= 0.7);
  assert.equal(similarity("Gabala", "Qabala"), 0.8);
  // Exonyms are not guessed: they need an alias learned from a confirmed pair.
  assert.equal(similarity("Bayern Munich", "Bayern München"), 0.4);
  assert.ok(similarity("Inter", "Internazionale") >= 0.9);
  assert.ok(similarity("Real Madrid", "Real Sociedad") < 0.7);
  assert.ok(similarity("Rapid București", "Dinamo București") < 0.5);
  assert.equal(similarity("Arsenal", "Chelsea"), 0);
});

// Real pairs seen live with the same Betradar ID on both books.
test("live naming differences between the books stay above name evidence", () => {
  for (const [superbet, betano] of [
    ["Alianza FC", "Alianza San Salvador"],
    ["Isidro Metapan", "AD Isidro Metapan"],
    ["NY Cosmos", "New York Cosmos"],
    ["Novorizontino SP", "Gremio Novorizontino"],
    ["Hercilio Luz", "Hercilio Luz SC"],
    ["Blumenau", "Blumenau Esporte Clube"],
    ["CD Plaza Amador (F)", "Plaza Amador (F)"],
  ])
    assert.ok(similarity(superbet, betano) >= 0.5, `${superbet} / ${betano}`);
  // State codes separate clubs: not strong enough for a name-only pair.
  assert.ok(similarity("Atletico GO", "Atletico MG") < 0.7);
  assert.ok(similarity("Genesis Policia Nacional", "Genesis Comayagua") < 0.5);
});

test("learned aliases make otherwise unrelated names equal", () => {
  const aliases = new Map([["fcsb", new Set(["steaua bucuresti"])]]);
  assert.equal(similarity("FCSB", "Steaua București"), 0);
  assert.equal(similarity("FCSB", "Steaua București", aliases), 1);
});
