import assert from "node:assert/strict";
import test from "node:test";
import { TaskController } from "../dist/tasks/controller.js";
import { until } from "./helpers/aggregation.mjs";

const command = (id, version = 1, selectionId = `${version}`) => ({
  id,
  category: "betano",
  version,
  payload: {
    provider: "betano",
    opportunityId: Number(id.replace(/\D/g, "")) || 1,
    eventId: 10,
    selectionId,
    expectedPrice: 2,
  },
});

function controlledAdapter() {
  const calls = [];
  const releases = [];
  let active = 0,
    maxActive = 0;
  return {
    calls,
    releases,
    get maxActive() {
      return maxActive;
    },
    async execute(payload) {
      calls.push(structuredClone(payload));
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => releases.push(resolve));
      active--;
      return { accepted: true };
    },
    async close() {},
  };
}

test("Betano tasks run FIFO one at a time and a pending update keeps its position", async () => {
  const adapter = controlledAdapter();
  const controller = new TaskController(
    { betano: adapter },
    { executionTimeoutMs: 1_000, shutdownTimeoutMs: 1_000 },
  );
  assert.equal(controller.submit(command("task-1")), "created");
  assert.equal(controller.submit(command("task-2")), "created");
  assert.equal(controller.submit(command("task-2", 2, "updated")), "updated");
  await until(() => adapter.calls.length === 1);
  assert.equal(adapter.maxActive, 1);
  adapter.releases.shift()();
  await until(() => adapter.calls.length === 2);
  assert.equal(adapter.calls[1].selectionId, "updated");
  assert.equal(adapter.maxActive, 1);
  adapter.releases.shift()();
  await until(() => controller.getStats().completed === 2);
  await controller.stop();
});

test("a withdrawn pending task never reaches the adapter", async () => {
  const adapter = controlledAdapter();
  const controller = new TaskController(
    { betano: adapter },
    { executionTimeoutMs: 1_000, shutdownTimeoutMs: 1_000 },
  );
  controller.submit(command("task-1"));
  controller.submit(command("task-2"));
  assert.equal(controller.withdraw("task-2"), true);
  adapter.releases.shift()();
  await until(() => controller.getStats().completed === 1);
  assert.equal(adapter.calls.length, 1);
  assert.equal(controller.getStats().cancelled, 1);
  await controller.stop();
});

test("a timeout marks the result uncertain and blocks the Betano category", async () => {
  const adapter = {
    calls: [],
    execute(payload) {
      this.calls.push(payload);
      return new Promise(() => {});
    },
    async close() {},
  };
  const controller = new TaskController(
    { betano: adapter },
    { executionTimeoutMs: 20, shutdownTimeoutMs: 100 },
  );
  controller.submit(command("task-1"));
  controller.submit(command("task-2"));
  await until(() => controller.getStats().uncertain === 1);
  assert.deepEqual(controller.getStats().blockedCategories, ["betano"]);
  assert.equal(controller.getStats().pending, 1);
  assert.equal(adapter.calls.length, 1);
  await controller.stop();
});

test("Betano and Superbet run independently while each category stays serial", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new TaskController(
    { betano, superbet },
    { executionTimeoutMs: 1_000, shutdownTimeoutMs: 1_000 },
  );
  controller.submit(command("betano-1"));
  controller.submit(command("betano-2"));
  controller.submit({
    id: "superbet-1",
    category: "superbet",
    version: 1,
    payload: {
      provider: "superbet",
      opportunityId: 1,
      sport: "football",
      eventId: 20,
      marketId: 65,
      selectionId: "selection-uuid",
      expectedPrice: 2,
    },
  });
  await until(() => betano.calls.length === 1 && superbet.calls.length === 1);
  assert.equal(betano.maxActive, 1);
  assert.equal(superbet.maxActive, 1);
  superbet.releases.shift()();
  betano.releases.shift()();
  await until(() => betano.calls.length === 2);
  betano.releases.shift()();
  await until(() => controller.getStats().completed === 3);
  await controller.stop();
});
