import assert from "node:assert/strict";
import test from "node:test";
import {
  BetanoStore,
  isBetanoEvent,
  isLiveEvent,
} from "../dist/providers/betano/processing/state.js";

const event = () => ({
  id: 11,
  sportId: "FOOT",
  isLive: true,
  marketIdList: [100],
});
const snapshot = (version = 1) => ({
  version,
  event: event(),
  markets: { 100: { id: 100, selectionIdList: [200], isSuspended: true } },
  selections: { 200: { id: 200, price: 2, isSuspended: true } },
});
const diff = (version, type, payload) => ({
  eventId: 11,
  version,
  type,
  payload,
});

function setup() {
  const published = [],
    updates = [],
    stale = [],
    removed = [];
  const store = new BetanoStore(3, {
    onSnapshot: (s) => published.push(structuredClone(s)),
    onUpdate: (d) => updates.push(d),
    onStale: (id) => stale.push(id),
    onRemove: (id) => removed.push(id),
  });
  store.add(event());
  return { store, published, updates, stale, removed };
}

test("unsupported sports, upcoming events, and ended events are excluded", () => {
  assert.equal(isBetanoEvent({ ...event(), sportId: "ICEH" }), false);
  assert.equal(isLiveEvent({ ...event(), isLive: undefined }), false);
  assert.equal(isLiveEvent({ ...event(), isEnded: true }), false);
  assert.equal(isLiveEvent(event()), true);
});

test("price changes restore omitted suspension flags and discard replayed versions", () => {
  const { store, updates } = setup();
  store.install(11, snapshot());
  store.receive(
    diff(2, 100, {
      marketChanges: [{ id: 100 }],
      selectionChanges: { 100: [{ id: 200, price: 3 }] },
    }),
  );
  store.receive(
    diff(2, 100, { selectionChanges: { 100: [{ id: 200, price: 99 }] } }),
  );
  const current = store.getSnapshot(11);
  assert.equal(current.selections[200].price, 3);
  assert.equal(current.selections[200].isSuspended, false);
  assert.equal(current.markets[100].isSuspended, false);
  assert.equal(updates.length, 1);
});

test("a missing version hides odds until a snapshot and buffered changes close the gap", () => {
  const { store, stale } = setup();
  store.install(11, snapshot());
  store.receive(
    diff(3, 100, { selectionChanges: { 100: [{ id: 200, price: 4 }] } }),
  );
  assert.equal(store.getSnapshot(11), null);
  assert.equal(store.install(11, snapshot(1)), false);
  assert.equal(store.install(11, snapshot(2)), true);
  assert.equal(store.getSnapshot(11).version, 3);
  assert.equal(store.getSnapshot(11).selections[200].price, 4);
  assert.deepEqual(stale, [11]);
});

test("unknown changes require an authoritative snapshot", () => {
  const { store } = setup();
  store.install(11, snapshot());
  store.receive(diff(2, 654, {}));
  assert.equal(store.getSnapshot(11), null);
  assert.equal(store.install(11, snapshot(2)), true);
});

test("additions, ordering, layout changes, and removals preserve selection references", () => {
  const { store } = setup();
  store.install(11, snapshot());
  store.receive(
    diff(2, 101, {
      markets: [{ id: 101, selections: [{ id: 201, price: 1.5 }] }],
    }),
  );
  store.receive(
    diff(3, 106, { marketIds: [101, 100], selectionIds: { 101: [201] } }),
  );
  store.receive(diff(4, 151, { selectionChanges: { 201: 2 } }));
  store.receive(
    diff(5, 110, { marketChanges: { 101: 3 }, selectionChanges: { 201: 4 } }),
  );
  assert.deepEqual(store.getSnapshot(11).event.marketIdList, [101, 100]);
  assert.equal(store.getSnapshot(11).selections[201].columnIndex, 2);
  assert.equal(store.getSnapshot(11).selections[201].renderingLayout, 4);
  store.receive(diff(6, 102, { marketIds: [101] }));
  assert.equal(store.getSnapshot(11).markets[101], undefined);
  assert.equal(store.getSnapshot(11).selections[201], undefined);
  assert.deepEqual(store.getSnapshot(11).event.marketIdList, [100]);
});

test("server resets can restart version numbering", () => {
  const { store } = setup();
  store.install(11, snapshot(10));
  store.receive(diff(1, 0, {}));
  assert.equal(store.getSnapshot(11), null);
  assert.equal(store.install(11, snapshot(1)), true);
  assert.equal(store.getSnapshot(11).version, 1);
});

test("buffer overflow stays bounded and never exposes incomplete odds", () => {
  const { store } = setup();
  for (let v = 2; v < 20; v++) store.receive(diff(v, 100, {}));
  assert.ok(store.events.get(11).pending.size <= 3);
  assert.equal(store.getSnapshot(11), null);
  assert.equal(store.install(11, snapshot(19)), true);
});

test("ended events are removed before they can publish more prices", () => {
  const { store, removed } = setup();
  store.install(11, snapshot());
  store.receive(diff(2, 2, { isEnded: true }));
  assert.equal(store.getSnapshot(11), null);
  assert.deepEqual(removed, [11]);
});
