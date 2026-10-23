import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ReconnectingSocket } from "../dist/network/streaming/websocket.js";

function setup(onChunk = () => true, autoOpen = true) {
  const created = [],
    opened = [],
    errors = [];
  const transport = {
    openSocket() {
      const socket = {
        readyState: 0,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send() {},
        close() {
          this.readyState = 3;
          this.onclose?.({ code: 1000 });
        },
      };
      created.push(socket);
      if (autoOpen)
        setImmediate(() => {
          if (socket.readyState === 0) {
            socket.readyState = 1;
            socket.onopen?.({});
          }
        });
      return socket;
    },
  };
  const subscription = new ReconnectingSocket({
    id: "test",
    origin: "https://test.invalid",
    path: "/socket",
    transport,
    connectTimeoutMs: 1000,
    idleTimeoutMs: 1000,
    retryDelayMs: 5,
    onOpen: (attempt) => opened.push(attempt),
    onChunk,
    onEnd() {},
    onError: (_, e) => errors.push(e.message),
    onStopped() {},
  });
  return { subscription, created, opened, errors };
}

test("socket cancellation interrupts an opening handshake", async () => {
  const { subscription, created } = setup(undefined, false);
  const running = subscription.run();
  await subscription.stop();
  await running;
  assert.equal(created[0].readyState, 3);
});

test("byte backpressure closes the socket and waits for credit before reconnecting", async () => {
  const { subscription, created, errors } = setup(() => false);
  void subscription.run();
  try {
    await delay(20);
    created[0].onmessage({ data: "payload" });
    await delay(20);
    assert.equal(created.length, 1);
    assert.match(errors[0], /byte limit/);
    subscription.resume();
    await delay(20);
    assert.equal(created.length, 2);
    assert.throws(() => subscription.send(1, "stale"), /no longer open/);
    subscription.send(2, "current");
  } finally {
    await subscription.stop();
  }
});
