import assert from "node:assert/strict";
import test from "node:test";
import {
  setTimeout as delay,
  setImmediate as turn,
} from "node:timers/promises";
import { SuperbetFeed } from "../dist/providers/superbet/processing/feed.js";
import { superbetConfig } from "../dist/providers/superbet/config.js";

const event = (id, version = 10) => ({
  event_id: id,
  increment_id: version,
  fixture: { sport_id: 5, event_name: `Home ${id}·Away` },
  inplay_stats_metadata: { status: "STARTED" },
  is_full_market_update: true,
  markets: [
    { id: 1, name: "Winner", odds: [{ uuid: "a", price: 2, status: 1 }] },
  ],
});
const response = (events, statusCode = 200, headers = {}) => ({
  type: "request-response",
  commandId: 1,
  response: {
    statusCode,
    headers,
    body: new TextEncoder().encode(JSON.stringify({ events })).buffer,
  },
});
async function settle() {
  for (let i = 0; i < 4; i++) await turn();
}

function fixture(events, options = {}, footballHandlers = {}) {
  let feed;
  let nextGeneration = 1;
  let sequence = 0;
  const streams = new Map();
  const acks = [];
  const requests = [];
  const errors = [];
  const states = [];
  const peer = {
    detail: async (id) => response([event(id)]),
    async command(command) {
      if (command.type === "request") {
        requests.push(command.request.path);
        if (command.request.path.includes("index=active-live"))
          return response(events);
        return this.detail(
          Number(
            new URLSearchParams(command.request.path.split("?")[1]).get(
              "events",
            ),
          ),
        );
      }
      if (command.type === "start-subscription") {
        const state = { generation: nextGeneration++, attempt: 1 };
        streams.set(command.id, state);
        queueMicrotask(() => peer.open(command.id));
      }
      if (command.type === "stop-subscription") {
        const state = streams.get(command.id);
        streams.delete(command.id);
        if (state)
          feed.handle({
            type: "stream-stopped",
            id: command.id,
            generation: state.generation,
          });
      }
      return { type: "command-success", commandId: 1 };
    },
    post(command) {
      acks.push(command);
    },
    open(id) {
      const state = streams.get(id);
      feed.handle({
        type: "stream-open",
        id,
        ...state,
        response: { statusCode: 200, headers: {} },
      });
    },
    stopped(id) {
      feed.handle({
        type: "stream-stopped",
        id: `superbet:event:${id}`,
        ...streams.get(`superbet:event:${id}`),
      });
    },
    data(id, updates) {
      const state = streams.get(`superbet:event:${id}`);
      feed.handle({
        type: "stream-chunk",
        id: `superbet:event:${id}`,
        ...state,
        sequence: ++sequence,
        chunk: new TextEncoder().encode(`data: ${JSON.stringify(updates)}\n\n`)
          .buffer,
      });
    },
    end(id) {
      feed.handle({
        type: "stream-end",
        id: `superbet:event:${id}`,
        ...streams.get(`superbet:event:${id}`),
        cancelled: false,
      });
    },
  };
  feed = new SuperbetFeed(
    peer,
    { ...superbetConfig, ...options },
    {
      onEvents() {},
      onSnapshot() {},
      onUpdate() {},
      onRemove() {},
      onStatus(status) {
        states.push(status);
      },
      onError(error, id) {
        errors.push({ error, id });
      },
      ...footballHandlers,
    },
  );
  return { feed, peer, streams, acks, requests, errors, states };
}

test("filtered football follows accepted SSE updates, invalidation, and recovery", async () => {
  const changes = [];
  const bases = [];
  const f = fixture(
    [event(1)],
    {},
    {
      onFootballSnapshot: (value) => bases.push(value),
      onFootballUpdate: (value) => changes.push(value),
    },
  );
  const base = {
    ...event(1),
    fixture: {
      sport_id: 5,
      event_name: "Home\u00b7Away",
      offer_state_status: { 2: 1 },
    },
    markets: [
      {
        id: 200734,
        name: "Total goluri",
        odds: [151888, 151889].map((id, index) => ({
          uuid: `quote-${index}`,
          price: 1.9,
          status: 1,
          display: true,
          metadata: {
            outcome_id: id,
            market_line_uuid: "line",
            offer_state_id: 2,
            specifiers: { total: "2.5" },
          },
        })),
      },
    ],
  };
  try {
    await f.feed.start();
    await settle();
    assert.equal(f.feed.getFootballSnapshot(1), null);
    f.peer.data(1, [base]);
    await settle();
    assert.equal(bases.length, 1);
    assert.equal(f.feed.getFootballSnapshot(1).lines.length, 1);
    f.peer.data(1, [
      {
        event_id: 1,
        increment_id: 11,
        markets: [
          {
            id: 200734,
            name: "Total goluri",
            odds: [{ uuid: "quote-1", price: 2.2 }],
          },
        ],
      },
    ]);
    await settle();
    assert.equal(changes[0].upserts[0].selections[1].price, 2.2);
    await f.feed.reconnect();
    await settle();
    assert.equal(changes.at(-1).kind, "invalidate");
    assert.equal(f.feed.getFootballSnapshot(1), null);
    f.peer.data(1, [{ ...base, increment_id: 12 }]);
    await settle();
    assert.equal(bases.length, 2);
    assert.equal(f.feed.getFootballSnapshot(1).sourceVersion, 12);
    assert.equal(f.errors.length, 0);
  } finally {
    await f.feed.stop();
  }
  assert.equal(f.feed.getFootballSnapshot(1), null);
});

test("discovery registers more than 100 independent streams and removes ended events", async () => {
  const events = Array.from({ length: 130 }, (_, i) => event(i + 1));
  events.push({
    ...event(999),
    fixture: { sport_id: 75, event_name: "Esoccer" },
  });
  const f = fixture(events);
  try {
    await f.feed.start();
    await settle();
    assert.equal(f.streams.size, 130);
    f.peer.data(1, [event(1)]);
    f.peer.data(2, [event(2)]);
    await settle();
    assert.equal(f.feed.getStats().synchronizedEvents, 2);
    assert.equal(f.acks.length, 2);
    f.peer.data(1, [
      {
        event_id: 1,
        increment_id: 11,
        inplay_stats_metadata: { status: "FINISHED" },
      },
    ]);
    await settle();
    assert.equal(f.streams.size, 129);
    assert.equal(f.feed.getSnapshot(1), null);
    assert.equal(f.feed.getSnapshot(2).increment_id, 10);
    assert.equal(f.errors.length, 0);
  } finally {
    await f.feed.stop();
  }
  assert.equal(f.streams.size, 0);
});

test("REST repairs an old baseline even when that match sends no later pushes", async () => {
  const f = fixture([event(1)], {
    synchronizationTimeoutMs: 10,
    retryDelayMs: 5,
  });
  try {
    await f.feed.start();
    await settle();
    f.peer.data(1, [event(1, 8)]);
    await settle();
    assert.equal(f.feed.getSnapshot(1), null);
    await delay(35);
    assert.equal(f.feed.getSnapshot(1).increment_id, 10);
    assert.equal(f.feed.getStats().snapshotRepairs, 1);
    assert.equal(f.errors.length, 0);
  } finally {
    await f.feed.stop();
  }
});

test("a REST response from an old connection cannot revalidate odds after reconnection", async () => {
  const f = fixture([event(1)], { synchronizationTimeoutMs: 10 });
  const pending = Promise.withResolvers();
  f.peer.detail = () => pending.promise;
  try {
    await f.feed.start();
    await settle();
    await delay(20);
    assert.equal(f.requests.length, 2);
    await f.feed.reconnect();
    await settle();
    pending.resolve(response([event(1, 20)]));
    await settle();
    assert.equal(f.feed.getSnapshot(1), null);
    f.peer.data(1, [event(1, 11)]);
    await settle();
    assert.equal(f.feed.getSnapshot(1).increment_id, 11);
    assert.equal(f.feed.getStats().reconnects, 1);
    assert.equal(f.errors.length, 0);
  } finally {
    pending.resolve(response([event(1)]));
    await f.feed.stop();
  }
});

test("snapshot repairs obey concurrency and shared Retry-After, then stop all retries", async () => {
  const f = fixture([event(1), event(2), event(3)], {
    synchronizationTimeoutMs: 5,
    maxConcurrentSnapshots: 1,
    retryDelayMs: 5,
  });
  let active = 0;
  let peak = 0;
  f.peer.detail = async () => {
    active++;
    peak = Math.max(peak, active);
    await delay(5);
    active--;
    return response([], 429, { "retry-after": "60" });
  };
  await f.feed.start();
  await delay(35);
  assert.equal(peak, 1);
  assert.equal(f.requests.length, 2);
  assert.equal(f.errors.length, 1);
  assert.equal(f.feed.getStats().synchronizedEvents, 0);
  await f.feed.stop();
  const count = f.requests.length;
  await delay(20);
  assert.equal(f.requests.length, count);
  assert.equal(f.streams.size, 0);
});

test("explicit reconnect discards already queued bytes from the previous subscription", async () => {
  const f = fixture([event(1)]);
  try {
    await f.feed.start();
    await settle();
    f.peer.data(1, [event(1, 99)]);
    await f.feed.reconnect();
    await settle();
    assert.equal(f.feed.getSnapshot(1), null);
    f.peer.data(1, [event(1, 11)]);
    await settle();
    assert.equal(f.feed.getSnapshot(1).increment_id, 11);
    assert.equal(f.acks.length, 2);
    assert.equal(f.errors.length, 0);
  } finally {
    await f.feed.stop();
  }
});

test("a permanently stopped SSE is removed without an immediate reconnect loop", async () => {
  const f = fixture([event(1)]);
  try {
    await f.feed.start();
    await settle();
    f.peer.stopped(1);
    await settle();
    assert.equal(f.feed.getSnapshot(1), null);
    assert.equal(f.streams.size, 0);
    assert.equal(f.feed.getStats().events, 0);
    assert.equal(f.feed.getStats().streamOpens, 1);
    assert.equal(f.errors.length, 0);
  } finally {
    await f.feed.stop();
  }
});
