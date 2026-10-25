import {
  tennisContext,
  tennisLineKey,
} from "../../../aggregation/adapter/tennis.js";
import { isRoleA } from "../../../aggregation/mapping.js";
import type { ProjectionCodec } from "../../../aggregation/model/adapter.interfaces.js";
import { betanoTennisMarkets } from "../tennis-markets.config.js";
import type {
  BetanoTennisEvent,
  BetanoTennisLine,
} from "../model/tennis-projection.interfaces.js";

/**
 * @file Translates Betano tennis projections into canonical quotes and explicit scoring context.
 */

const catalog = new Map<number, (typeof betanoTennisMarkets)[number]>(
  betanoTennisMarkets.map((m) => [m.typeId, m]),
);

export const betanoTennisCodec: ProjectionCodec<
  BetanoTennisEvent,
  BetanoTennisLine
> = {
  provider: "betano",
  identity: (event) => ({
    eventId: event.id,
    betradarId: event.betradarId ?? 0,
    startsAt: event.startsAt === null ? NaN : Date.parse(event.startsAt),
    competitionId: event.competitionId ?? 0,
    categoryId: event.categoryId ?? 0,
    home: event.player1.name,
    away: event.player2.name,
  }),
  live: (event) => ({
    live: event.phase === "live",
    suspended: event.isSuspended,
    homeScore: event.player1Sets,
    awayScore: event.player2Sets,
    clockSeconds: null,
    clockRunning: false,
    tennis: tennisContext(event),
  }),
  marketType: (line) => line.marketTypeId,
  lineKey: (line, row) => {
    const definition = catalog.get(line.marketTypeId);
    if (
      definition &&
      ((definition.period === "match" && line.setNumber !== null) ||
        (definition.period === "set" && line.setNumber === null))
    )
      return null;
    return definition
      ? tennisLineKey(
          row,
          definition.kind,
          line.total,
          line.handicap,
          line.setNumber,
          line.gameNumber,
        )
      : null;
  },
  quote: (line, quote) => {
    const [first, second] = line.selections;
    const a = isRoleA(first.role) ? first : second,
      b = a === first ? second : first;
    quote.priceA = a.price ?? NaN;
    quote.priceB = b.price ?? NaN;
    quote.usableA = !line.isSuspended && !a.isSuspended;
    quote.usableB = !line.isSuspended && !b.isSuspended;
  },
};
