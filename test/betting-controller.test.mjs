import assert from "node:assert/strict";
import test from "node:test";
import { BettingController } from "../dist/betting/controller.js";
import { until } from "./helpers/aggregation.mjs";

function controlledAdapter() {
  const calls = [];
  const pending = [];
  return {
    calls,
    pending,
    execute(payload) {
      calls.push(structuredClone(payload));
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    async close() {},
  };
}

function opportunity(kind, superbetPrice, marginBps, sport = "football", id = 1) {
  return {
    sport,
    kind,
    id,
    at: Date.now(),
    betradarId: 100,
    superbetEventId: 200,
    betanoEventId: 300,
    match: "Home - Away",
    score: "0-0",
    marketCode: 1,
    concept: "Total",
    line: 1.5,
    legs: [
      {
        provider: "superbet",
        marketId: 708,
        selectionId: "selection-superbet",
        outcome: "A",
        label: "Peste",
        price: superbetPrice,
        stakeShare: 0.5,
        ageMs: 0,
      },
      {
        provider: "betano",
        marketId: 69,
        selectionId: "12345",
        outcome: "B",
        label: "Sub",
        price: 2.12,
        stakeShare: 0.5,
        ageMs: 0,
      },
    ],
    marginBps,
    maxMarginBps: marginBps,
    suspicious: false,
    openedAt: Date.now(),
    durationMs: 0,
    unconfirmedMs: 0,
  };
}

test("a failed provider keeps retrying every newer profitable quote beyond maxAttempts", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 1, superbet: 1 },
    {},
  );
  controller.onOpportunity(opportunity("open", 2.17, 800));
  await until(() => betano.calls.length === 1);
  assert.equal(superbet.calls.length, 0);
  betano.pending.shift().resolve({ accepted: true });
  await until(() => superbet.calls.length === 1);

  controller.onOpportunity(opportunity("update", 2.25, 915));
  assert.equal(superbet.calls.length, 1);
  superbet.pending.shift().reject(new Error("oddCoefficientChanged"));

  await until(() => superbet.calls.length === 2);
  assert.equal(superbet.calls[0].expectedPrice, 2.17);
  assert.equal(superbet.calls[1].expectedPrice, 2.25);
  controller.onOpportunity(opportunity("update", 2.3, 1_000));
  superbet.pending.shift().reject(new Error("oddCoefficientChanged"));
  await until(() => superbet.calls.length === 3);
  assert.equal(superbet.calls[2].expectedPrice, 2.3);
  superbet.pending.shift().resolve({ ticketId: "accepted" });
  await until(() => controller.getStats().completed === 1);
  await controller.stop();
});

test("a failed provider is not retried below a 0.50 percent margin", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 1, superbet: 1 },
    {},
  );
  controller.onOpportunity(opportunity("open", 2.17, 800));
  await until(() => betano.calls.length === 1);
  assert.equal(superbet.calls.length, 0);
  betano.pending.shift().resolve({ accepted: true });
  await until(() => superbet.calls.length === 1);
  controller.onOpportunity(opportunity("update", 1.7, 49));
  superbet.pending.shift().reject(new Error("oddCoefficientChanged"));
  await until(() => controller.getStats().failed === 1);

  controller.onOpportunity(opportunity("update", 2.4, 1_000));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(superbet.calls.length, 1);
  await controller.stop();
});

test("tennis places Betano first and submits Superbet only after Betano passes", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 1, superbet: 1 },
    {},
  );
  controller.onOpportunity(opportunity("open", 2.17, 800, "tennis"));
  await until(() => betano.calls.length === 1);
  assert.equal(superbet.calls.length, 0);

  controller.onOpportunity(opportunity("update", 2.25, 915, "tennis"));
  betano.pending.shift().resolve({ accepted: true });
  await until(() => superbet.calls.length === 1);
  assert.equal(superbet.calls[0].expectedPrice, 2.25);
  superbet.pending.shift().resolve({ ticketId: "accepted" });
  await until(() => controller.getStats().completed === 2);
  await controller.stop();
});

test("tennis never submits Superbet when Betano cannot be placed", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 1, superbet: 1 },
    {},
  );
  controller.onOpportunity(opportunity("open", 2.17, 800, "tennis"));
  await until(() => betano.calls.length === 1);
  controller.onOpportunity(opportunity("update", 1.7, 49, "tennis"));
  betano.pending.shift().reject(new Error("oddCoefficientChanged"));
  await until(() => controller.getStats().failed === 1);
  assert.equal(superbet.calls.length, 0);
  await controller.stop();
});

test("tennis does not submit Superbet when the margin expires before Betano passes", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 1, superbet: 1 },
    {},
  );
  controller.onOpportunity(opportunity("open", 2.17, 800, "tennis"));
  await until(() => betano.calls.length === 1);
  controller.onOpportunity(opportunity("update", 1.7, 49, "tennis"));
  betano.pending.shift().resolve({ accepted: true });
  await until(() => controller.getStats().completed === 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(superbet.calls.length, 0);
  await controller.stop();
});

test("a margin close still hedges on Superbet when Betano passes above 0.50 percent", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 1, superbet: 1 },
    {},
  );
  controller.onOpportunity(opportunity("open", 2.17, 698));
  await until(() => betano.calls.length === 1);
  controller.onOpportunity({
    ...opportunity("close", 2.5, 465),
    reason: "margin",
  });

  betano.pending.shift().resolve({ accepted: true });
  await until(() => superbet.calls.length === 1);
  assert.equal(superbet.calls[0].expectedPrice, 2.5);
  superbet.pending.shift().resolve({ ticketId: "accepted" });
  await until(() => controller.getStats().completed === 2);
  await controller.stop();
});

test("an unlinked close never submits Superbet after Betano passes", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 1, superbet: 1 },
    {},
  );
  controller.onOpportunity(opportunity("open", 2.17, 698));
  await until(() => betano.calls.length === 1);
  controller.onOpportunity({
    ...opportunity("close", 2.5, 465),
    reason: "unlinked",
  });

  betano.pending.shift().resolve({ accepted: true });
  await until(() => controller.getStats().completed === 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(superbet.calls.length, 0);
  await controller.stop();
});

test("football places Betano first and then retries Superbet on newer quotes", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 1, superbet: 1 },
    {},
  );
  controller.onOpportunity(opportunity("open", 2.17, 800));
  await until(() => betano.calls.length === 1);
  assert.equal(superbet.calls.length, 0);
  betano.pending.shift().resolve({ accepted: true });
  await until(() => superbet.calls.length === 1);
  controller.onOpportunity(opportunity("update", 2.25, 915));
  superbet.pending.shift().reject(new Error("oddCoefficientChanged"));
  await until(() => superbet.calls.length === 2);
  assert.equal(superbet.calls[1].expectedPrice, 2.25);
  superbet.pending.shift().resolve({ ticketId: "accepted" });
  await until(() => controller.getStats().completed === 2);
  await controller.stop();
});

test("football never submits Superbet when Betano cannot be placed", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 1, superbet: 1 },
    {},
  );
  controller.onOpportunity(opportunity("open", 2.17, 800));
  await until(() => betano.calls.length === 1);
  assert.equal(superbet.calls.length, 0);
  controller.onOpportunity(opportunity("update", 1.7, 49));
  betano.pending.shift().reject(new Error("oddCoefficientChanged"));
  await until(() => controller.getStats().failed === 1);

  controller.onOpportunity(opportunity("update", 2.4, 1_000));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(superbet.calls.length, 0);
  await controller.stop();
});

test("zero maxAttempts still disables the provider's initial attempt", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 0, superbet: 0 },
    {},
  );
  controller.onOpportunity(opportunity("open", 2.17, 800));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(betano.calls.length, 0);
  assert.equal(superbet.calls.length, 0);
  await controller.stop();
});

test("only one opportunity flow runs until both provider tasks finish", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 2, superbet: 2 },
    {},
  );
  controller.onOpportunity(opportunity("open", 2.17, 800, "football", 1));
  controller.onOpportunity(opportunity("open", 2.25, 900, "football", 2));
  await until(() => betano.calls.length === 1);
  assert.equal(betano.calls[0].opportunityId, 1);

  betano.pending.shift().resolve({ accepted: true });
  await until(() => superbet.calls.length === 1);
  assert.equal(superbet.calls[0].opportunityId, 1);
  assert.equal(betano.calls.length, 1);

  superbet.pending.shift().resolve({ ticketId: "accepted" });
  await until(() => betano.calls.length === 2);
  assert.equal(betano.calls[1].opportunityId, 2);
  betano.pending.shift().resolve({ accepted: true });
  await until(() => superbet.calls.length === 2);
  superbet.pending.shift().resolve({ ticketId: "accepted" });
  await until(() => controller.getStats().completed === 4);
  await controller.stop();
});

test("maxAttempts counts only passed bets and a failure releases the next opportunity", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 1, superbet: 1 },
    {},
  );
  controller.onOpportunity(opportunity("open", 2.17, 800, "football", 1));
  controller.onOpportunity(opportunity("open", 2.25, 900, "football", 2));
  await until(() => betano.calls.length === 1);
  betano.pending.shift().reject(new Error("rejected"));

  await until(() => betano.calls.length === 2);
  assert.deepEqual(
    betano.calls.map((call) => call.opportunityId),
    [1, 2],
  );
  betano.pending.shift().resolve({ accepted: true });
  await until(() => superbet.calls.length === 1);
  superbet.pending.shift().resolve({ ticketId: "accepted" });
  await until(() => controller.getStats().completed === 2);

  controller.onOpportunity(opportunity("open", 2.4, 1_000, "football", 3));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(betano.calls.length, 2);
  assert.equal(superbet.calls.length, 1);
  await controller.stop();
});

test("a suspended Superbet leg waits for a new quote and retries before releasing the flow", async () => {
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 2, superbet: 2 },
    {},
    100,
  );
  controller.onOpportunity(opportunity("open", 2.17, 800, "tennis", 1));
  controller.onOpportunity(opportunity("open", 2.4, 1_000, "football", 2));
  await until(() => betano.calls.length === 1);
  betano.pending.shift().resolve({ accepted: true });
  await until(() => superbet.calls.length === 1);

  controller.onOpportunity({
    ...opportunity("close", 2.17, 800, "tennis", 1),
    reason: "suspended",
  });
  superbet.pending.shift().reject(new Error("oddCoefficientChanged"));
  await until(() => controller.getStats().failed === 1);
  assert.equal(betano.calls.length, 1);
  assert.equal(superbet.calls.length, 1);

  controller.onOpportunity(opportunity("open", 2.25, 900, "tennis", 1));
  await until(() => superbet.calls.length === 2);
  assert.equal(superbet.calls[1].expectedPrice, 2.25);
  assert.equal(betano.calls.length, 1);
  superbet.pending.shift().resolve({ ticketId: "accepted" });

  await until(() => betano.calls.length === 2);
  assert.equal(betano.calls[1].opportunityId, 2);
  betano.pending.shift().resolve({ accepted: true });
  await until(() => superbet.calls.length === 3);
  superbet.pending.shift().resolve({ ticketId: "accepted" });
  await until(() => controller.getStats().completed === 4);
  await controller.stop();
});

test("a suspended Superbet wait logs its timeout and then releases the next flow", async (t) => {
  const logs = [];
  t.mock.method(console, "log", (line) => logs.push(String(line)));
  const betano = controlledAdapter();
  const superbet = controlledAdapter();
  const controller = new BettingController(
    { betano, superbet },
    { betano: 2, superbet: 2 },
    {},
    20,
  );
  controller.onOpportunity(opportunity("open", 2.17, 800, "tennis", 1));
  controller.onOpportunity(opportunity("open", 2.4, 1_000, "football", 2));
  await until(() => betano.calls.length === 1);
  betano.pending.shift().resolve({ accepted: true });
  await until(() => superbet.calls.length === 1);
  controller.onOpportunity({
    ...opportunity("close", 2.17, 800, "tennis", 1),
    reason: "suspended",
  });
  superbet.pending.shift().reject(new Error("oddCoefficientChanged"));

  await until(() => betano.calls.length === 2);
  assert.equal(superbet.calls.length, 1);
  assert.ok(logs.some((line) => line.includes("[SUPERBET WAITING]")));
  assert.ok(
    logs.some(
      (line) =>
        line.includes("[SUPERBET NOT RETRIED]") &&
        line.includes("nu a aparut o cota noua in 0.02s"),
    ),
  );

  betano.pending.shift().resolve({ accepted: true });
  await until(() => superbet.calls.length === 2);
  superbet.pending.shift().resolve({ ticketId: "accepted" });
  await until(() => controller.getStats().completed === 3);
  await controller.stop();
});
