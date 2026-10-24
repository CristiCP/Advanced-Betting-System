import { superbetFootballMarkets } from "../football-markets.config.js";
import type { SuperbetFootballMarketDefinition } from "../model/football-markets.interfaces.js";
import type {
  SuperbetFootballEvent,
  SuperbetFootballLine,
  SuperbetFootballSelection,
} from "../model/football-projection.interfaces.js";
import type {
  SuperbetMarket,
  SuperbetOdd,
  SuperbetRecord,
  SuperbetSnapshot,
} from "../model/state.interfaces.js";
import { isRecord } from "./state.js";

/**
 * @file Projects exact catalog matches into validated two-selection football lines.
 */

const catalog = new Map(
  superbetFootballMarkets.map((definition) => [definition.id, definition]),
);

const text = (value: unknown): string | null =>
  typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : null;
const integer = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
// Superbet publishes the Betradar match ID as a decimal string.
const betradar = (value: unknown): number | null =>
  typeof value === "string" &&
  /^[1-9]\d{0,15}$/.test(value) &&
  Number.isSafeInteger(Number(value))
    ? Number(value)
    : null;

// Reject a start time when the ISO date and the epoch field disagree.
function startTime(fixture: SuperbetSnapshot["fixture"]): string | null {
  const parsed =
    typeof fixture.utc_date === "string" ? Date.parse(fixture.utc_date) : NaN;
  if (!Number.isFinite(parsed)) return null;
  const epoch = fixture.unix_date_millis;
  if (epoch !== undefined && epoch !== parsed) return null;
  return new Date(parsed).toISOString();
}

// Preserve local event identity and source state without copying the vendor fixture.
export function footballEvent(
  snapshot: SuperbetSnapshot,
): SuperbetFootballEvent | null {
  const fixture = snapshot.fixture;
  if (fixture.sport_id !== 5 || typeof fixture.event_name !== "string")
    return null;
  const teams = fixture.event_name.split("\u00b7");
  const [home, away] = teams;
  const status = snapshot.inplay_stats_metadata?.status;
  if (
    teams.length !== 2 ||
    !home?.trim() ||
    !away?.trim() ||
    home === away ||
    (status !== "STARTED" && status !== "NOT_STARTED")
  )
    return null;
  const phase = status === "STARTED" ? "live" : "prematch";
  const offerStatus = integer(
    fixture.offer_state_status?.[phase === "live" ? "2" : "1"],
  );
  if (offerStatus === 2) return null;
  return {
    id: snapshot.event_id,
    betradarId: betradar(fixture.betradar_id),
    home: { id: text(fixture.home_team_id), name: home },
    away: { id: text(fixture.away_team_id), name: away },
    competitionId: integer(fixture.tournament_id),
    categoryId: integer(fixture.category_id),
    startsAt: startTime(fixture),
    phase,
    status,
    offerStatus,
    homeScore: text(snapshot.inplay_stats?.home_team_score),
    awayScore: text(snapshot.inplay_stats?.away_team_score),
    period: text(snapshot.inplay_stats_metadata?.event_status_label),
    minute: text(snapshot.inplay_stats?.minutes),
    stoppageTime: text(snapshot.inplay_stats?.stoppage_time),
  };
}

export function footballMarketKey(market: SuperbetMarket): string {
  return `${market.id}:${market.name}`;
}

// Parse only structured decimal parameters, including zero and negative handicaps.
function decimal(value: unknown): number | null {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? (parsed === 0 ? 0 : parsed) : null;
}

function parameters(
  metadata: SuperbetRecord,
  definition: SuperbetFootballMarketDefinition,
): SuperbetRecord | null {
  const values = metadata.specifiers ?? {};
  if (
    !isRecord(values) ||
    Object.keys(values).length !== definition.parameters.length ||
    !definition.parameters.every(
      (key) => typeof values[key] === "string" && decimal(values[key]) !== null,
    )
  )
    return null;
  return values;
}

// A line keeps all members for cardinality checks, including suspended selections.
function line(
  market: SuperbetMarket,
  odds: SuperbetOdd[],
  definition: SuperbetFootballMarketDefinition,
  event: SuperbetFootballEvent,
): SuperbetFootballLine | null {
  if (
    odds.length !== 2 ||
    odds[0]!.uuid === odds[1]!.uuid ||
    odds.some((odd) => odd.display !== true)
  )
    return null;
  const metadata = odds[0]!.metadata!;
  const params = parameters(metadata, definition);
  const other = parameters(odds[1]!.metadata!, definition);
  if (
    !params ||
    !other ||
    !definition.parameters.every(
      (key) => decimal(params[key]) === decimal(other[key]),
    )
  )
    return null;
  const total = definition.parameters.includes("total")
    ? decimal(params.total)
    : null;
  const handicap = definition.parameters.includes("hcp")
    ? decimal(params.hcp)
    : null;
  const from = definition.parameters.includes("from")
    ? decimal(params.from)
    : null;
  const to = definition.parameters.includes("to") ? decimal(params.to) : null;
  const firstMinutes = definition.parameters.includes("xnr")
    ? decimal(params.xnr)
    : null;
  if (total !== null && total < 0) return null;
  if (
    firstMinutes !== null &&
    (!Number.isInteger(firstMinutes) || firstMinutes < 1 || firstMinutes > 90)
  )
    return null;
  if (
    definition.period === "interval" &&
    (from === null ||
      to === null ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to > 89 ||
      to - from + 1 !== definition.intervalMinutes ||
      from % definition.intervalMinutes! !== 0)
  )
    return null;
  const expectedName = definition.nameTemplate
    .replaceAll("<HOME_TEAM>", () => event.home.name)
    .replaceAll("<AWAY_TEAM>", () => event.away.name)
    .replaceAll("<FROM>", String(from))
    .replaceAll("<TO>", String(to));
  if (market.name !== expectedName) return null;
  const selections: SuperbetFootballSelection[] = [];
  for (const outcome of definition.outcomes) {
    const odd = odds.find(
      (candidate) => candidate.metadata!.outcome_id === outcome.id,
    );
    if (
      !odd ||
      (odd.price !== undefined &&
        (typeof odd.price !== "number" ||
          !Number.isFinite(odd.price) ||
          odd.price < 0))
    )
      return null;
    selections.push({
      id: odd.uuid,
      outcomeId: outcome.id,
      role: outcome.role,
      price: odd.price ?? null,
      status: integer(odd.status),
      display: true,
      handicap:
        handicap === null
          ? null
          : outcome.role === "away" && handicap !== 0
            ? -handicap
            : handicap,
    });
  }
  const offerStateId = event.phase === "live" ? 2 : 1;
  const lineId = metadata.market_line_uuid as string;
  return {
    key: `${market.id}:${offerStateId}:${lineId}`,
    marketId: market.id,
    lineId,
    offerStateId,
    total,
    handicap,
    fromMinute: from,
    toMinute: to,
    firstMinutes,
    selections: [selections[0]!, selections[1]!],
  };
}

// Unknown IDs, names, parameters, and incomplete pairs never enter the filtered view.
export function footballLines(
  market: SuperbetMarket,
  event: SuperbetFootballEvent,
): Map<string, SuperbetFootballLine> {
  const result = new Map<string, SuperbetFootballLine>();
  const definition = catalog.get(market.id);
  if (!definition) return result;
  const groups = new Map<string, SuperbetOdd[]>();
  const seen = new Set<string>();
  for (const odd of market.odds) {
    const meta = odd.metadata;
    if (
      !odd.uuid ||
      seen.has(odd.uuid) ||
      !isRecord(meta) ||
      typeof meta.market_line_uuid !== "string" ||
      !meta.market_line_uuid ||
      !Number.isSafeInteger(meta.outcome_id) ||
      (meta.offer_state_id !== 1 && meta.offer_state_id !== 2)
    )
      return result;
    seen.add(odd.uuid);
    if (meta.offer_state_id !== (event.phase === "live" ? 2 : 1)) continue;
    const group = groups.get(meta.market_line_uuid);
    if (group) group.push(odd);
    else groups.set(meta.market_line_uuid, [odd]);
  }
  for (const odds of groups.values()) {
    const projected = line(market, odds, definition, event);
    if (projected) result.set(projected.key, projected);
  }
  return result;
}
