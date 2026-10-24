import { footballLineKey } from "../../../aggregation/adapter/football.js";
import { isRoleA } from "../../../aggregation/mapping.js";
import type { FootballCodec } from "../../../aggregation/model/adapter.interfaces.js";
import { superbetFootballMarkets } from "../football-markets.config.js";
import type {
  SuperbetFootballEvent,
  SuperbetFootballLine,
} from "../model/football-projection.interfaces.js";

/**
 * @file Translates Superbet football projections into canonical aggregation values.
 */

const catalog = new Map(
  superbetFootballMarkets.map((definition) => [definition.id, definition]),
);

const halfTimeSeconds = 45 * 60;
const count = (value: string | null): number | null =>
  value !== null && /^\d{1,5}$/.test(value) ? Number(value) : null;
const positive = (value: number | null): number =>
  value !== null && value > 0 ? value : 0;
const epoch = (value: string | null): number => {
  const parsed = value === null ? NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

export const superbetFootballCodec: FootballCodec<
  SuperbetFootballEvent,
  SuperbetFootballLine
> = {
  provider: "superbet",
  identity: (event) => ({
    eventId: event.id,
    betradarId: event.betradarId ?? 0,
    startsAt: epoch(event.startsAt),
    competitionId: positive(event.competitionId),
    categoryId: positive(event.categoryId),
    home: event.home.name,
    away: event.away.name,
  }),
  // Live offer status 1 is the only state observed with tradable odds; anything else counts as suspended.
  // The clock runs during a half (1H/2H) and stands at 45:00 at half time; other periods are unknown.
  live: (event) => {
    const running =
      (event.period === "1H" || event.period === "2H") &&
      event.minute !== null &&
      /^\d{1,3}$/.test(event.minute);
    const halfTime = event.period === "HT";
    return {
      live: event.phase === "live",
      suspended: event.offerStatus !== 1,
      homeScore: count(event.homeScore),
      awayScore: count(event.awayScore),
      clockSeconds: running
        ? Number(event.minute) * 60
        : halfTime
          ? halfTimeSeconds
          : null,
      clockRunning: running,
    };
  },
  marketType: (line) => line.marketId,
  // First-X-minutes lines have no mapped counterpart; interval lines are keyed by their slot.
  lineKey: (line, row) => {
    const definition = catalog.get(line.marketId);
    if (definition === undefined || line.firstMinutes !== null) return null;
    let variant = 0;
    if (definition.period === "interval") {
      if (line.fromMinute === null || !definition.intervalMinutes) return null;
      variant = line.fromMinute / definition.intervalMinutes;
    }
    return footballLineKey(
      row,
      definition.kind,
      "superbet",
      line.total,
      line.handicap,
      variant,
    );
  },
  // Status 1 is the observed active state; status 2 and unknown values are not tradable.
  quote: (line, quote) => {
    const [first, second] = line.selections;
    const firstIsA = isRoleA(first.role);
    const a = firstIsA ? first : second;
    const b = firstIsA ? second : first;
    quote.priceA = a.price ?? NaN;
    quote.priceB = b.price ?? NaN;
    quote.usableA = a.status === 1 && a.display;
    quote.usableB = b.status === 1 && b.display;
  },
};
