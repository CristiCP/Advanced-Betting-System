import assert from "node:assert/strict";
import test from "node:test";
import {
  BatchWriter,
  WireError,
  fullStateBytes,
  lineCode,
  lineKey,
  lineQuarters,
  lineVariant,
  liveFlags,
  readHeader,
  valueFlags,
} from "../dist/aggregation/protocol/wire.js";
import { decode, identity } from "./helpers/aggregation.mjs";

const key = lineKey(1, 10);

function sample(writer = new BatchWriter()) {
  writer.writeReset();
  writer.eventIdentity(3, identity());
  writer.eventLive(3, liveFlags.live | liveFlags.score | liveFlags.clock, 1, 0, 1_234);
  writer.lineDefine(9, 3, key);
  writer.value(9, 1.85, 2.05, valueFlags.usableA | valueFlags.usableB);
  // An operation after values must open a second segment.
  writer.lineRelease(9);
  writer.eventRelease(3);
  return writer.finish("betano", 4, 12, 1_792_850_401_000);
}

test("batch round trip keeps operation order, names, and values", () => {
  const { header, calls } = decode(sample());
  assert.deepEqual(
    { ...header, byteLength: undefined },
    {
      provider: "betano",
      generation: 4,
      sequence: 12,
      sentAt: 1_792_850_401_000,
      byteLength: undefined,
      segments: 2,
    },
  );
  assert.deepEqual(calls, [
    ["reset"],
    ["identity", 3, identity()],
    ["live", 3, 13, 1, 0, 1_234],
    ["define", 9, 3, key],
    ["value", 9, 1.85, 2.05, 3],
    ["line-release", 9],
    ["event-release", 3],
  ]);
});

test("unknown start time and missing Betradar ID survive encoding", () => {
  const writer = new BatchWriter();
  writer.eventIdentity(0, identity(8, { betradarId: 0, startsAt: NaN }));
  const [[, , value]] = decode(writer.finish("superbet", 1, 1, 0)).calls;
  assert.equal(value.betradarId, 0);
  assert.ok(Number.isNaN(value.startsAt));
});

test("a small buffer grows without corrupting earlier records", () => {
  const writer = new BatchWriter(new ArrayBuffer(48));
  writer.eventIdentity(0, identity());
  for (let line = 0; line < 500; line++) writer.lineDefine(line, 0, key);
  for (let line = 0; line < 500; line++)
    writer.value(line, 1.5 + line / 1_000, NaN, valueFlags.usableA);
  const { calls } = decode(writer.finish("superbet", 1, 1, 0));
  assert.equal(calls.length, 1_001);
  assert.deepEqual(calls.at(-1), ["value", 499, 1.999, NaN, 1]);
});

test("line keys pack market code, signed quarter line, and variant", () => {
  const value = lineKey(4095, -3, 15);
  assert.equal(lineCode(value), 4095);
  assert.equal(lineQuarters(value), -3);
  assert.equal(lineVariant(value), 15);
  assert.equal(lineQuarters(lineKey(13, 32_767)), 32_767);
  assert.ok(lineKey(4095, 32_767, 15) <= 0xffff_ffff);
  for (const invalid of [
    [0, 0],
    [4096, 0],
    [1, 32_768],
    [1, 0.5],
    [1, 0, 16],
  ])
    assert.equal(lineKey(...invalid), null);
});

test("the full-state bound covers a complete re-emission", () => {
  const writer = new BatchWriter();
  writer.writeReset();
  // Three UTF-8 bytes per character is the worst case for names within the length limit.
  const names = { home: "€".repeat(128), away: "₿".repeat(128) };
  for (let event = 0; event < 4; event++) {
    writer.eventIdentity(event, identity(event + 1, names));
    writer.eventLive(event, liveFlags.live, 0, 0, 0);
    writer.closeSegment();
  }
  for (let line = 0; line < 16; line++) writer.lineDefine(line, line % 4, key);
  for (let line = 0; line < 16; line++) writer.value(line, 2, 2, 3);
  const buffer = writer.finish("superbet", 1, 1, 0);
  assert.equal(decode(buffer).calls.length, 1 + 4 * 2 + 16 * 2);
  assert.ok(writer.byteLength <= fullStateBytes(4, 16));
});

function corrupt(change) {
  const buffer = sample();
  change(new DataView(buffer), buffer);
  return () => decode(buffer);
}

test("malformed batches are rejected before they reach state", () => {
  const cases = {
    magic: (view) => view.setUint32(0, 0, true),
    provider: (view) => view.setUint8(6, 9),
    timestamp: (view) => view.setFloat64(16, NaN, true),
    length: (view) => view.setUint32(24, 40, true),
    trailing: (view) => view.setUint32(28, 1, true),
    opcode: (view) => view.setUint8(40, 77),
    // The first operation starts at byte 40; its home name length follows the 45-byte fixed part.
    utf8: (view) => view.setUint8(40 + 45 + 2, 0xff),
    "empty name": (view) => view.setUint16(40 + 45, 0, true),
  };
  for (const [name, change] of Object.entries(cases))
    assert.throws(corrupt(change), WireError, name);
  assert.throws(() => readHeader(new ArrayBuffer(8)), WireError);
  assert.throws(() => readHeader("batch"), WireError);
});

test("invalid identities, live states, and prices are rejected", () => {
  const writes = {
    "same teams": (w) => w.eventIdentity(0, identity(1, { away: "Steaua București" })),
    "fractional id": (w) => w.eventIdentity(0, identity(1.5)),
    "negative betradar": (w) => w.eventIdentity(0, identity(1, { betradarId: -2 })),
    "score without flag": (w) => w.eventLive(0, liveFlags.live, 1, 0, 0),
    "unknown live flag": (w) => w.eventLive(0, 0x10, 0, 0, 0),
    "zero key": (w) => w.lineDefine(0, 0, 0),
    "usable NaN": (w) => w.value(0, NaN, 2, valueFlags.usableA),
    "price one": (w) => w.value(0, 1, 2, 0),
    "infinite price": (w) => w.value(0, Infinity, 2, 0),
    "unknown value flag": (w) => w.value(0, 2, 2, 4),
  };
  for (const [name, write] of Object.entries(writes)) {
    const writer = new BatchWriter();
    write(writer);
    const buffer = writer.finish("superbet", 1, 1, 0);
    assert.throws(() => decode(buffer), WireError, name);
  }
});
