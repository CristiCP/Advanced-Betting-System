import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  SseParser,
  SuperbetSseDecoder,
  decodeJson,
} from "../dist/providers/superbet/protocol/sse.js";

test("SSE handles split UTF-8, BOM, CR/LF, comments, multiple records, and incomplete EOF", () => {
  const records = [];
  const parser = new SseParser(1024, { onData: (data) => records.push(data) });
  const data = new TextEncoder().encode(
    '\ufeff:heartbeat\r\ndata: {"name":"câștigă",\rdata: "x":1}\r\ndata\r\rdata: two\n\ndata: unfinished',
  );
  for (const byte of data) parser.push(new Uint8Array([byte]));
  assert.deepEqual(records, ['{"name":"câștigă",\n"x":1}\n', "two"]);
  const bounded = new SseParser(10, { onData() {} });
  assert.throws(
    () => bounded.push(new TextEncoder().encode("data: 1234567890123")),
    /limit/,
  );
});

test("gzip delivery processes split raw chunks before returning network credits", async () => {
  const records = [];
  const decoder = new SuperbetSseDecoder("gzip", 1024, {
    onData: (data) => records.push(data),
  });
  const bytes = gzipSync("data: [1]\n\ndata: [2]\n\n");
  try {
    for (let i = 0; i < bytes.length; i += 3)
      await decoder.write(
        bytes
          .subarray(i, i + 3)
          .buffer.slice(
            bytes.byteOffset + i,
            bytes.byteOffset + Math.min(i + 3, bytes.length),
          ),
      );
    await decoder.end();
    assert.deepEqual(records, ["[1]", "[2]"]);
  } finally {
    decoder.close();
  }
});

test("compressed malformed and oversized records fail without retaining a decoder", async () => {
  const decoder = new SuperbetSseDecoder("gzip", 20, { onData() {} });
  try {
    const bytes = gzipSync(`data: ${"x".repeat(200)}\n\n`);
    await assert.rejects(decoder.write(Uint8Array.from(bytes).buffer), /limit/);
  } finally {
    decoder.close();
  }
  const body = Uint8Array.from(
    gzipSync(JSON.stringify({ events: [1] })),
  ).buffer;
  assert.deepEqual(
    await decodeJson(
      { statusCode: 200, headers: { "content-encoding": "gzip" }, body },
      1024,
    ),
    { events: [1] },
  );
  await assert.rejects(
    decodeJson(
      { statusCode: 200, headers: { "content-encoding": "gzip" }, body },
      10,
    ),
    /limit/,
  );
});

test("closing a decoder settles pending writes and finalization", async () => {
  const writing = new SuperbetSseDecoder("gzip", 1024, { onData() {} });
  const finishing = new SuperbetSseDecoder("gzip", 1024, { onData() {} });
  const bytes = Uint8Array.from(gzipSync("data: [1]\n\n")).buffer;
  const pendingWrite = writing.write(bytes);
  writing.close();
  const pendingEnd = finishing.end();
  finishing.close();
  let timer;
  try {
    await Promise.race([
      Promise.all([pendingWrite, pendingEnd]),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Decoder cancellation hung.")),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    writing.close();
    finishing.close();
  }
});
