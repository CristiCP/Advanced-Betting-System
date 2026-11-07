import assert from "node:assert/strict";
import test from "node:test";
import { BetanoTaskAdapter } from "../dist/tasks/adapters/betano.js";

test("Betano keeps polling the same pending placement until it is accepted", async () => {
  const adapter = new BetanoTaskAdapter({
    origin: "https://betano.beta",
    cookie: "session=test",
    stake: 2,
    maxAttempts: 1,
  });
  const paths = [];
  let confirmations = 0;
  adapter.connect = async () => ({});
  adapter.request = async (_session, method, path) => {
    paths.push(`${method} ${path}`);
    if (path === "/api/betslip/v3/plain-leg/")
      return {
        data: {
          hash: "hash",
          slipData: "slip",
          legs: [],
          bets: [{}],
          betSlipTabId: 1,
          betslipTrackId: "track",
        },
      };
    if (path === "/api/betslip/v3/updatebets")
      return {
        data: {
          hash: "hash",
          slipData: "slip",
          legs: [],
          bets: [{}],
          betSlipTabId: 1,
          betslipTrackId: "track",
        },
      };
    if (path === "/api/betslip/v3/place")
      return {
        data: {
          pending: true,
          uniqueId: "12345",
          inPlayDelayMillis: 0,
        },
      };
    confirmations++;
    return confirmations === 1
      ? {
          data: {
            pending: true,
            uniqueId: "12345",
            inPlayDelayMillis: 0,
          },
        }
      : { data: { accepted: true, receipts: [{ betId: "ticket" }] } };
  };

  const result = await adapter.execute(
    {
      provider: "betano",
      opportunityId: 1,
      eventId: 10,
      selectionId: "20",
      expectedPrice: 2,
    },
    new AbortController().signal,
  );

  assert.equal(result.accepted, true);
  assert.equal(
    paths.filter((path) => path === "POST /api/betslip/v3/place").length,
    1,
  );
  assert.equal(
    paths.filter(
      (path) => path === "POST /api/betslip/v3/placed/12345",
    ).length,
    2,
  );
});
