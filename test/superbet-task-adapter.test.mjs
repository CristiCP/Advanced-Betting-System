import assert from "node:assert/strict";
import test from "node:test";
import { SuperbetTaskAdapter } from "../dist/tasks/adapters/superbet.js";
import { BetanoTaskAdapter } from "../dist/tasks/adapters/betano.js";

const options = {
  origin: "https://beta.api.web.production.betler.superbet.ro",
  siteOrigin: "https://beta.superbet.ro",
  offerOrigin: "https://production-superbet-offer-ro.freetls.fastly.net",
  cookie: "session=test",
  stake: 2,
  maxAttempts: 1,
};

test("zero maximum attempts disables either betting adapter", () => {
  assert.doesNotThrow(
    () => new SuperbetTaskAdapter({ ...options, maxAttempts: 0 }),
  );
  assert.doesNotThrow(
    () =>
      new BetanoTaskAdapter({
        origin: "https://betano.beta",
        cookie: "",
        stake: 2,
        maxAttempts: 0,
      }),
  );
});

test("Superbet builds the captured live handicap ticket with fixed odds", () => {
  const adapter = new SuperbetTaskAdapter(options);
  const payload = {
    provider: "superbet",
    opportunityId: 1,
    sport: "football",
    eventId: 15045340,
    marketId: 200737,
    selectionId: "d931e7a3-3a9f-5148-be98-62b4082d8723",
    expectedPrice: 1.11,
  };
  const selection = {
    fixture: {
      uuid: "d6aab241-b6be-579a-9a25-1938dc8c0332",
      betradar_id: "71998232",
      home_team_id: "5642",
      away_team_id: "6629",
      category_id: 195,
      event_code: 3979,
      event_name: "CSKA Sofia FC·Ludogorets Razgrad",
      sport_id: 5,
      tournament_id: 677,
      utc_date: "2026-10-26T17:30:00Z",
    },
    market: { id: 200737, name: "Prima repriză - Handicap" },
    odd: {
      uuid: payload.selectionId,
      price: 1.1,
    },
    metadata: {
      outcome_id: 151895,
      info: "Ludogorets Razgrad câştigă (1.5)",
      name: "Ludogorets Razgrad (1.5)",
      market_line_uuid: "72b2b189-356b-5e2f-b326-703cd0b4c021",
      special_bet_value: "-1.5",
    },
  };
  const names = {
    sports: new Map([[5, "Fotbal"]]),
    categories: new Map([[195, "Bulgaria"]]),
    tournaments: new Map([[677, "Bulgaria - Parva Liga"]]),
  };

  const first = adapter.ticket(payload, selection, names);
  const second = adapter.ticket(payload, selection, names);
  assert.equal(first.autoAcceptChanges, "0");
  assert.equal(first.total, 2);
  assert.notEqual(first.ticketUuid, second.ticketUuid);
  assert.equal(first.deviceIdentifier, second.deviceIdentifier);
  assert.deepEqual(
    {
      value: first.items[0].value,
      eventId: first.items[0].eventId,
      marketId: first.items[0].marketId,
      oddUuid: first.items[0].oddUuid,
      oddCode: first.items[0].oddCode,
      sbValue: first.items[0].sbValue,
      matchDate: first.items[0].matchDate,
      tournamentName: first.items[0].tournamentName,
    },
    {
      value: "1.11",
      eventId: 15045340,
      marketId: 200737,
      oddUuid: payload.selectionId,
      oddCode: "",
      sbValue: "-1.5",
      matchDate: "2026-10-26 19:30:00",
      tournamentName: "Parva Liga",
    },
  );
});
