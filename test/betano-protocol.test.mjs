import assert from "node:assert/strict";
import test from "node:test";
import lz4 from "lz4js";
import { decodeDiffs } from "../dist/providers/betano/protocol/compression.js";
import { SignalRSession } from "../dist/providers/betano/protocol/signalr.js";

const chunk = (text) => new TextEncoder().encode(text).buffer;

test("SignalR handles split records and acknowledges successful invocations", async () => {
  const sent = [],
    calls = [];
  let ready = 0;
  const session = new SignalRSession(1000, 1000, 1024, {
    send: async (s) => {
      sent.push(s);
    },
    onReady: () => ready++,
    onInvocation: (...args) => calls.push(args),
    onError: (e) => {
      throw e;
    },
  });
  try {
    session.start();
    session.receive(chunk("{"));
    session.receive(chunk("}\x1e"));
    assert.equal(ready, 1);
    const joined = session.invoke("join", { eventIds: [11] });
    const invocation = JSON.parse(sent[1].slice(0, -1));
    session.receive(
      chunk(
        JSON.stringify({ type: 3, invocationId: invocation.invocationId }) +
          '\x1e{"type":1,"target":"changes","arguments":[1]}\x1e',
      ),
    );
    await joined;
    assert.deepEqual(calls, [["changes", [1]]]);
    const rejected = session.invoke("invalid", {});
    const next = JSON.parse(sent[2].slice(0, -1));
    session.receive(
      chunk(
        JSON.stringify({
          type: 3,
          invocationId: next.invocationId,
          error: "Rejected",
        }) + "\x1e",
      ),
    );
    await assert.rejects(rejected, /Rejected/);
  } finally {
    session.stop();
  }
});

test("SignalR rejects oversized input and stops pending invocations", async () => {
  const session = new SignalRSession(1000, 1000, 64, {
    send: async () => {},
    onReady() {},
    onInvocation() {},
    onError() {},
  });
  session.start();
  session.receive(chunk("{}\x1e"));
  const pending = session.invoke("join", {});
  assert.throws(() => session.receive(chunk("x".repeat(65))), /limit exceeded/);
  session.stop();
  await assert.rejects(pending, /stopped/);
});

test("LZ4 batches decode and reject malformed or oversized content", () => {
  const diffs = [{ eventId: 11, version: 2, type: 100, payload: {} }];
  const encoded = Buffer.from(
    lz4.compress(Buffer.from(JSON.stringify(diffs))),
  ).toString("base64");
  assert.deepEqual(decodeDiffs(encoded, 32 * 1024 * 1024), diffs);
  assert.throws(() => decodeDiffs(encoded, 1), /byte limit/);
  assert.throws(() => decodeDiffs("invalid", 1024), /LZ4/);
});
