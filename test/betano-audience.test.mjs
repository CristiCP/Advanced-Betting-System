import assert from "node:assert/strict";
import test from "node:test";
import { eventAudienceSnapshot } from "../dist/providers/betano/protocol/audience.js";

test("REST versions match captured split event-and-market baselines, including audience 8", () => {
  // Independent public response metadata, checked against the corresponding live sequence.
  for (const [version, audiences, split] of [
    [150, { 1: 33, 2: 17, 4: 91, 7: 9, 8: 0 }, 133],
    [210, { 1: 54, 2: 19, 4: 127, 7: 10, 8: 0 }, 191],
    [134, { 1: 18, 2: 9, 4: 103, 7: 4, 8: 0 }, 125],
    [184, { 1: 16, 2: 5, 4: 161, 7: 2, 8: 1 }, 179],
    [209, { 1: 33, 2: 11, 4: 165, 7: 0, 8: 1 }, 198],
  ]) {
    const raw = { version, versionsPerAudience: audiences, event: { id: 11, incidents: [1], incidentFilters: [2] }, markets: {}, selections: {} };
    const selected = eventAudienceSnapshot(raw);
    assert.equal(selected.version, split);
    assert.equal(selected.restVersion, version);
    assert.equal(selected.event.incidents, undefined);
    assert.equal(selected.event.incidentFilters, undefined);
    assert.deepEqual(raw.event.incidents, [1]);
  }
});

test("missing, malformed, overflowing and contradictory audience versions stay unusable", () => {
  const baseline = { version: 10, versionsPerAudience: { 1: 2, 2: 1, 4: 6, 7: 1 }, event: { id: 11 } };
  for (const changes of [
    { versionsPerAudience: undefined }, { versionsPerAudience: {} },
    { versionsPerAudience: { 1: -1, 4: 11 } }, { versionsPerAudience: { 1: "10" } },
    { versionsPerAudience: { 1: 9 } }, { version: -1 },
    { versionsPerAudience: { "01": 10 } }, { versionsPerAudience: { 256: 10 } },
    { version: Number.MAX_SAFE_INTEGER, versionsPerAudience: { 1: Number.MAX_SAFE_INTEGER, 4: 1 } },
  ]) assert.throws(() => eventAudienceSnapshot({ ...baseline, ...changes }), /audience/i);
});
