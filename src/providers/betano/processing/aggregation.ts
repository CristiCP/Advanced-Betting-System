import { footballLineKey } from "../../../aggregation/adapter/football.js";
import { isRoleA } from "../../../aggregation/mapping.js";
import type { FootballCodec } from "../../../aggregation/model/adapter.interfaces.js";
import { betanoFootballMarkets } from "../football-markets.config.js";
import type { BetanoFootballMarketDefinition } from "../model/football-markets.interfaces.js";
import type {
  BetanoFootballEvent,
  BetanoFootballLine,
} from "../model/football-projection.interfaces.js";

/**
 * @file Translates Betano football projections into canonical aggregation values.
 */

const catalog = new Map<number, BetanoFootballMarketDefinition>(
  betanoFootballMarkets.map((definition) => [definition.typeId, definition]),
);

const count = (value: string | null): number | null =>
  value !== null && /^\d{1,5}$/.test(value) ? Number(value) : null;
const epoch = (value: string | null): number => {
  const parsed = value === null ? NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

export const betanoFootballCodec: FootballCodec<
  BetanoFootballEvent,
  BetanoFootballLine
> = {
  provider: "betano",
  identity: (event) => ({
    eventId: event.id,
    betradarId: event.betradarId ?? 0,
    startsAt: epoch(event.startsAt),
    competitionId: event.competitionId ?? 0,
    categoryId: event.categoryId ?? 0,
    home: event.home.name,
    away: event.away.name,
  }),
  live: (event) => ({
    live: event.phase === "live",
    suspended: event.isSuspended,
    homeScore: count(event.homeScore),
    awayScore: count(event.awayScore),
    // Betano omits default values: a running clock has no clockStopped, a stopped one sends true.
    clockSeconds:
      event.clockSeconds === null ? null : Math.floor(event.clockSeconds),
    clockRunning: event.clockStopped !== true,
  }),
  marketType: (line) => line.marketTypeId,
  // Score-based handicaps and intervals ending on a period boundary have no confirmed equivalent.
  lineKey: (line, row) => {
    const definition = catalog.get(line.marketTypeId);
    if (definition === undefined || line.scoreContext !== null) return null;
    let variant = 0;
    if (definition.period === "interval") {
      if (
        line.interval === null ||
        line.interval.endsAtPeriodBoundary ||
        !definition.intervalMinutes
      )
        return null;
      variant = line.interval.fromSecond / (definition.intervalMinutes * 60);
    }
    return footballLineKey(
      row,
      definition.kind,
      "betano",
      line.total,
      line.handicap,
      variant,
    );
  },
  // Suspension is checked per selection and per line; event suspension travels in the live state.
  quote: (line, quote) => {
    const [first, second] = line.selections;
    const firstIsA = isRoleA(first.role);
    const a = firstIsA ? first : second;
    const b = firstIsA ? second : first;
    quote.priceA = a.price ?? NaN;
    quote.priceB = b.price ?? NaN;
    quote.usableA = !a.isSuspended && !line.isSuspended;
    quote.usableB = !b.isSuspended && !line.isSuspended;
  },
};
