import { superbetTennisMarkets } from "../tennis-markets.config.js";
import type { SuperbetTennisMarketDefinition } from "../model/tennis-markets.interfaces.js";
import type {
  SuperbetTennisEvent,
  SuperbetTennisLine,
  SuperbetTennisSelection,
  SuperbetTennisSetScore,
} from "../model/tennis-projection.interfaces.js";
import type {
  SuperbetMarket,
  SuperbetOdd,
  SuperbetRecord,
  SuperbetSnapshot,
} from "../model/state.interfaces.js";
import { isRecord } from "./state.js";

/**
 * @file Validates tennis context and projects catalog markets into complete binary lines.
 */

const catalog = new Map(
  superbetTennisMarkets.map((definition) => [definition.id, definition]),
);
const integer = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const text = (value: unknown): string | null =>
  typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : null;

function decimal(value: unknown): number | null {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? (parsed === 0 ? 0 : parsed) : null;
}

function score(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function points(value: unknown): string | null {
  if (value === "A" || value === "AD") return value;
  const parsed = score(value);
  return parsed === null ? null : String(parsed);
}

// A vendor period type is preserved, not interpreted as proof of a match-tiebreak format.
function setScores(value: unknown): SuperbetTennisSetScore[] {
  if (!Array.isArray(value)) return [];
  const sets: SuperbetTennisSetScore[] = [];
  const seen = new Set<number>();
  for (const period of value) {
    if (!isRecord(period)) return [];
    const number = integer(period.num);
    if (number === null || number < 1 || number > 5 || seen.has(number))
      return [];
    seen.add(number);
    sets.push({
      number,
      player1Games: score(period.home_team_score),
      player2Games: score(period.away_team_score),
      sourceType: integer(period.type),
    });
  }
  return sets.sort((a, b) => a.number - b.number);
}

export function tennisEvent(
  snapshot: SuperbetSnapshot,
): SuperbetTennisEvent | null {
  const fixture = snapshot.fixture;
  if (
    !isRecord(fixture) ||
    fixture.sport_id !== 2 ||
    fixture.is_outright_event === true ||
    typeof fixture.event_name !== "string"
  )
    return null;
  const players = fixture.event_name.split("\u00b7");
  const [player1, player2] = players;
  const status = snapshot.inplay_stats_metadata?.status;
  if (
    players.length !== 2 ||
    !player1?.trim() ||
    !player2?.trim() ||
    player1 === player2 ||
    (status !== "STARTED" && status !== "NOT_STARTED")
  )
    return null;
  const phase = status === "STARTED" ? "live" : "prematch";
  const offerStatus = integer(
    fixture.offer_state_status?.[phase === "live" ? "2" : "1"],
  );
  if (offerStatus === 2) return null;
  const timestamp =
    typeof fixture.utc_date === "string" ? Date.parse(fixture.utc_date) : NaN;
  const startKnown =
    Number.isFinite(timestamp) &&
    (fixture.unix_date_millis === undefined ||
      fixture.unix_date_millis === timestamp);
  const rawId = fixture.betradar_id;
  const betradarId =
    typeof rawId === "string" &&
    /^[1-9]\d{0,15}$/.test(rawId) &&
    Number.isSafeInteger(Number(rawId))
      ? Number(rawId)
      : null;
  const stats = snapshot.inplay_stats;
  return {
    id: snapshot.event_id,
    betradarId,
    player1: { id: text(fixture.home_team_id), name: player1 },
    player2: { id: text(fixture.away_team_id), name: player2 },
    competitionId: integer(fixture.tournament_id),
    categoryId: integer(fixture.category_id),
    startsAt: startKnown ? new Date(timestamp).toISOString() : null,
    phase,
    status,
    offerStatus,
    player1Sets: score(stats?.home_team_score),
    player2Sets: score(stats?.away_team_score),
    player1Points: points(stats?.home_team_game_score),
    player2Points: points(stats?.away_team_game_score),
    serving:
      stats?.team_serving === 1
        ? "player1"
        : stats?.team_serving === 2
          ? "player2"
          : null,
    sets: setScores(stats?.periods),
  };
}

export function tennisMarketKey(market: SuperbetMarket): string {
  return `${market.id}:${market.name}`;
}

function parameters(
  metadata: SuperbetRecord,
  definition: SuperbetTennisMarketDefinition,
): Record<string, number> | null {
  const raw = metadata.specifiers ?? {};
  if (
    !isRecord(raw) ||
    Object.keys(raw).length !== definition.parameters.length
  )
    return null;
  const parsed: Record<string, number> = {};
  for (const key of definition.parameters) {
    const value = decimal(raw[key]);
    if (value === null) return null;
    if (key === "total" && value < 0) return null;
    if (
      (key === "setnr" || key === "gamenr") &&
      (!Number.isSafeInteger(value) ||
        value < 1 ||
        (key === "setnr" && value > 5))
    )
      return null;
    parsed[key] = value;
  }
  return parsed;
}

// Replace only catalog placeholders; runtime labels cannot introduce a new market type.
function label(
  template: string,
  event: SuperbetTennisEvent,
  params: Record<string, number>,
  handicap: number | null = null,
): string {
  return template
    .replaceAll("<PLAYER_1>", () => event.player1.name)
    .replaceAll("<PLAYER_2>", () => event.player2.name)
    .replaceAll("<SET>", String(params.setnr))
    .replaceAll("<GAME>", String(params.gamenr))
    .replaceAll("<TOTAL>", String(params.total))
    .replaceAll("<HANDICAP>", String(handicap));
}

function line(
  market: SuperbetMarket,
  odds: SuperbetOdd[],
  definition: SuperbetTennisMarketDefinition,
  event: SuperbetTennisEvent,
): SuperbetTennisLine | null {
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
    !definition.parameters.every((key) => params[key] === other[key])
  )
    return null;
  if (market.name !== label(definition.nameTemplate, event, params))
    return null;
  const handicap = params.hcp ?? null;
  const selections: SuperbetTennisSelection[] = [];
  for (const outcome of definition.outcomes) {
    const odd = odds.find(
      (candidate) => candidate.metadata!.outcome_id === outcome.id,
    );
    const signed =
      handicap === null
        ? null
        : outcome.role === "player2" && handicap !== 0
          ? -handicap
          : handicap;
    if (
      !odd ||
      odd.metadata!.name !==
        label(outcome.nameTemplate, event, params, signed) ||
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
      handicap: signed,
    });
  }
  const offerStateId = event.phase === "live" ? 2 : 1;
  const lineId = metadata.market_line_uuid as string;
  return {
    key: `${market.id}:${offerStateId}:${lineId}`,
    marketId: market.id,
    lineId,
    offerStateId,
    total: params.total ?? null,
    handicap,
    setNumber: params.setnr ?? null,
    gameNumber: params.gamenr ?? null,
    selections: [selections[0]!, selections[1]!],
  };
}

// Count every member before filtering availability; one-sided and reduced multiway markets stay excluded.
export function tennisLines(
  market: SuperbetMarket,
  event: SuperbetTennisEvent,
): Map<string, SuperbetTennisLine> {
  const result = new Map<string, SuperbetTennisLine>();
  const definition = catalog.get(market.id);
  if (!definition || !Array.isArray(market.odds)) return result;
  const groups = new Map<string, SuperbetOdd[]>();
  const seen = new Set<string>();
  for (const odd of market.odds) {
    const metadata = odd.metadata;
    if (
      typeof odd.uuid !== "string" ||
      !odd.uuid ||
      seen.has(odd.uuid) ||
      !isRecord(metadata) ||
      typeof metadata.market_line_uuid !== "string" ||
      !metadata.market_line_uuid ||
      !Number.isSafeInteger(metadata.outcome_id) ||
      (metadata.offer_state_id !== 1 && metadata.offer_state_id !== 2)
    )
      return result;
    seen.add(odd.uuid);
    if (metadata.offer_state_id !== (event.phase === "live" ? 2 : 1)) continue;
    const group = groups.get(metadata.market_line_uuid);
    if (group) group.push(odd);
    else groups.set(metadata.market_line_uuid, [odd]);
  }
  for (const odds of groups.values()) {
    const projected = line(market, odds, definition, event);
    if (projected) result.set(projected.key, projected);
  }
  return result;
}
