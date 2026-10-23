import assert from "node:assert/strict";
import test from "node:test";
import { SuperbetStore, isLive } from "../dist/providers/superbet/processing/state.js";

const market = (price = 2) => ({
  id: 1,
  name: "Winner",
  odds: [
    { uuid: "a", price, status: 1, display: true, metadata: { name: "Home" } },
  ],
});
const full = (version, extra = {}) => ({
  event_id: 11,
  increment_id: version,
  fixture: { sport_id: 5, event_name: "Home·Away" },
  inplay_stats_metadata: { status: "STARTED" },
  is_full_market_update: true,
  markets: [market()],
  ...extra,
});
function setup(version = 10) {
  const seen = { snapshots: [], updates: [], stale: [], removed: [] };
  const store = new SuperbetStore(2, {
    onSnapshot: (snapshot) => seen.snapshots.push(snapshot),
    onUpdate: (update) => seen.updates.push(update),
    onStale: (id) => seen.stale.push(id),
    onRemove: (id) => seen.removed.push(id),
  });
  store.add(full(version));
  return { store, seen };
}

test("cached SSE must catch up to the discovery version before odds are exposed", () => {
  const { store, seen } = setup(12);
  store.receive(full(10));
  assert.equal(store.getSnapshot(11), null);
  store.receive({ event_id: 11, increment_id: 11, markets: [market(3)] });
  assert.equal(store.getSnapshot(11), null);
  store.receive({
    event_id: 11,
    increment_id: 12,
    inplay_stats: { minutes: "5" },
  });
  assert.equal(store.getSnapshot(11).markets[0].odds[0].price, 3);
  assert.equal(seen.snapshots.length, 1);
  assert.equal(seen.updates.length, 0);
  store.receive({ event_id: 11, increment_id: 11, markets: [market(99)] });
  assert.equal(store.getSnapshot(11).increment_id, 12);
});

test("version gaps stay stale until REST and buffered pushes form a complete state", () => {
  const { store, seen } = setup();
  store.receive(full(10));
  store.receive({ event_id: 11, increment_id: 12, markets: [market(4)] });
  assert.equal(store.getSnapshot(11), null);
  store.install(full(11, { markets: [market(3)] }));
  assert.equal(store.getSnapshot(11).increment_id, 12);
  assert.equal(store.getSnapshot(11).markets[0].odds[0].price, 4);
  assert.equal(seen.stale.length, 1);
  store.invalidate(11, "disconnected", true);
  assert.equal(store.getSnapshot(11), null);
  store.receive(full(10));
  assert.equal(store.getSnapshot(11), null);
  store.install(full(12));
  assert.equal(store.getSnapshot(11).increment_id, 12);
});

test("suspensions, hidden selections, and full empty markets preserve vendor semantics", () => {
  const { store } = setup();
  store.receive(full(10));
  store.receive({
    event_id: 11,
    increment_id: 11,
    markets: [{ id: 1, name: "Winner", odds: [{ uuid: "a", status: 3 }] }],
  });
  assert.equal(store.getSnapshot(11).markets[0].odds[0].price, 2);
  assert.equal(store.getSnapshot(11).markets[0].odds[0].status, 3);
  store.receive({
    event_id: 11,
    increment_id: 12,
    markets: [{ id: 1, name: "Winner", odds: [{ uuid: "a", display: false }] }],
  });
  assert.deepEqual(store.getSnapshot(11).markets, []);
  store.receive(full(13));
  store.receive({
    event_id: 11,
    increment_id: 14,
    is_full_market_update: true,
  });
  assert.deepEqual(store.getSnapshot(11).markets, []);
  const empty = setup();
  empty.store.receive(full(10, { markets: undefined }));
  assert.deepEqual(empty.store.getSnapshot(11).markets, []);
});

test("unknown selections trigger repair, bounded overflow cannot hide a missing increment", () => {
  const { store } = setup();
  store.receive(full(10));
  store.receive({
    event_id: 11,
    increment_id: 11,
    markets: [{ ...market(), odds: [{ uuid: "unknown", price: 3 }] }],
  });
  assert.equal(store.getSnapshot(11), null);
  store.receive({ event_id: 11, increment_id: 14 });
  store.receive({ event_id: 11, increment_id: 15 });
  assert.ok(store.events.get(11).pending.size <= 2);
  store.install(full(12));
  assert.equal(store.getSnapshot(11), null);
  store.install(full(15));
  assert.equal(store.getSnapshot(11).increment_id, 15);
});

test("special markets replace independently and ended matches are removed", () => {
  const { store, seen } = setup();
  store.receive(full(10, { superbets: [market(5)] }));
  store.receive({
    event_id: 11,
    increment_id: 11,
    is_full_market_update: true,
    markets: [],
  });
  assert.equal(store.getSnapshot(11).superbets[0].odds[0].price, 5);
  store.receive({
    event_id: 11,
    increment_id: 12,
    is_full_superbets_update: true,
  });
  assert.deepEqual(store.getSnapshot(11).superbets, []);
  store.receive({
    event_id: 11,
    increment_id: 13,
    inplay_stats_metadata: { status: "ENDED" },
  });
  assert.equal(store.getSnapshot(11), null);
  assert.deepEqual(seen.removed, [11]);
  assert.equal(
    isLive(full(10, { fixture: { sport_id: 75, event_name: "Virtual" } })),
    false,
  );
  assert.equal(
    isLive(full(10, { inplay_stats_metadata: { status: "NOT_STARTED" } })),
    false,
  );
});

test("explicit zero live markets are complete even when the full-market flag is absent", () => {
  const { store } = setup();
  const empty = full(10, {
    markets: undefined,
    is_full_market_update: undefined,
    inplay_stats_metadata: {
      status: "STARTED",
      counts: { markets: { 2: 0 }, odds: { 2: 0 } },
    },
  });
  store.receive(empty);
  assert.deepEqual(store.getSnapshot(11).markets, []);
  store.receive(full(11));
  store.receive({
    event_id: 11,
    increment_id: 12,
    inplay_stats_metadata: empty.inplay_stats_metadata,
  });
  assert.deepEqual(store.getSnapshot(11).markets, []);
  assert.equal(
    isLive(
      full(12, {
        fixture: {
          sport_id: 5,
          event_name: "Ended",
          offer_state_status: { 2: 2 },
        },
      }),
    ),
    false,
  );
});
