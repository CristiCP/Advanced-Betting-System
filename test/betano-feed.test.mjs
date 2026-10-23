import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { BetanoFeed } from "../dist/providers/betano/processing/feed.js";
import { betanoConfig } from "../dist/providers/betano/config.js";

test("server cooldown is shared across snapshots and shutdown cancels retries", async () => {
  let feed;
  let requests = 0;
  let sequence = 0;
  let generation = 0;
  const sockets = new Map();
  const events = {
    11: { id: 11, sportId: "FOOT", isLive: true, marketIdList: [] },
    12: { id: 12, sportId: "TENN", isLive: true, marketIdList: [] },
  };
  const chunk = (id, record) => {
    const current = sockets.get(id);
    if (!current) return;
    feed.handle({
      type: "stream-chunk",
      id,
      generation: current.generation,
      attempt: 1,
      sequence: ++sequence,
      chunk: new TextEncoder().encode(record + "\x1e").buffer,
    });
  };
  const network = {
    async command(command) {
      if (command.type === "request") {
        requests++;
        const overview = command.request.path.includes("/overview/");
        return {
          type: "request-response",
          commandId: 1,
          response: {
            statusCode: overview ? 200 : 429,
            headers: { "retry-after": "60" },
            body: new TextEncoder().encode(
              JSON.stringify(overview ? { events } : {}),
            ).buffer,
          },
        };
      }
      if (command.type === "start-socket") {
        const current = { generation: ++generation };
        sockets.set(command.id, current);
        queueMicrotask(() =>
          feed.handle({
            type: "stream-open",
            id: command.id,
            generation: current.generation,
            attempt: 1,
            response: { statusCode: 101, headers: {} },
          }),
        );
      }
      if (command.type === "stop-socket") sockets.delete(command.id);
      if (command.type === "send-socket") {
        const message = JSON.parse(command.data.slice(0, -1));
        queueMicrotask(() =>
          chunk(
            command.id,
            JSON.stringify(
              message.protocol
                ? {}
                : { type: 3, invocationId: message.invocationId },
            ),
          ),
        );
      }
      return { type: "command-success", commandId: 1 };
    },
    post() {},
  };
  const errors = [];
  feed = new BetanoFeed(
    network,
    { ...betanoConfig, retryDelayMs: 5 },
    {
      onEvents() {},
      onSnapshot() {},
      onUpdate() {},
      onRemove() {},
      onStatus() {},
      onError: (error) => errors.push(error),
    },
  );
  try {
    await feed.start();
    await delay(40);
    assert.ok(errors.some((error) => error.includes("429")));
    const before = requests;
    await delay(40);
    assert.equal(requests, before);
    assert.equal(feed.getStats().synchronizedEvents, 0);
  } finally {
    await feed.stop();
  }
  const stoppedRequests = requests;
  await delay(20);
  assert.equal(requests, stoppedRequests);
  assert.equal(sockets.size, 0);
});
