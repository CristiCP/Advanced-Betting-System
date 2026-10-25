import {
  tennisContext,
  tennisLineKey,
} from "../../../aggregation/adapter/tennis.js";
import { isRoleA } from "../../../aggregation/mapping.js";
import type { ProjectionCodec } from "../../../aggregation/model/adapter.interfaces.js";
import { superbetTennisMarkets } from "../tennis-markets.config.js";
import type {
  SuperbetTennisEvent,
  SuperbetTennisLine,
} from "../model/tennis-projection.interfaces.js";

/**
 * @file Translates Superbet tennis projections into canonical quotes and explicit scoring context.
 */

const catalog = new Map<number, (typeof superbetTennisMarkets)[number]>(
  superbetTennisMarkets.map((m) => [m.id, m]),
);

export const superbetTennisCodec: ProjectionCodec<
  SuperbetTennisEvent,
  SuperbetTennisLine
> = {
  provider: "superbet",
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
    suspended: event.offerStatus !== 1,
    homeScore: event.player1Sets,
    awayScore: event.player2Sets,
    clockSeconds: null,
    clockRunning: false,
    tennis: tennisContext(event),
  }),
  marketType: (line) => line.marketId,
  lineKey: (line, row) => {
    const definition = catalog.get(line.marketId);
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
    quote.usableA = a.status === 1 && a.display;
    quote.usableB = b.status === 1 && b.display;
  },
};
