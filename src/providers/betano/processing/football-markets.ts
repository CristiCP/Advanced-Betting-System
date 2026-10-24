import { betanoFootballMarkets } from "../football-markets.config.js";
import type {
  BetanoFootballMarketDefinition,
  BetanoFootballOutcomeDefinition,
} from "../model/football-markets.interfaces.js";
import type {
  BetanoFootballEvent,
  BetanoFootballInterval,
  BetanoFootballLine,
  BetanoFootballScoreContext,
  BetanoFootballSelection,
} from "../model/football-projection.interfaces.js";
import type {
  BetanoMarket,
  BetanoSelection,
  BetanoSnapshot,
} from "../model/state.interfaces.js";
import { isRecord } from "./state.js";

/**
 * @file Validates fixed football market templates and projects complete two-selection lines.
 */

const catalog = new Map<number, BetanoFootballMarketDefinition>(
  betanoFootballMarkets.map((m) => [m.typeId, m]),
);
const decimal = /^[+-]?\d+(?:\.\d+)?$/;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const normalized = (value: number): number =>
  Object.is(value, -0) ? 0 : value;
const identifier = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : null;
const score = (value: unknown): string | null =>
  typeof value === "string" && /^\d+$/.test(value) ? value : null;
const escape = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Copy only event context used by the next stage; never retain mutable vendor objects.
export function footballEvent(
  snapshot: Pick<BetanoSnapshot, "event">,
): BetanoFootballEvent | null {
  const source = snapshot.event;
  if (
    source.sportId !== "FOOT" ||
    source.isEnded === true ||
    typeof source.isLive !== "boolean" ||
    !identifier(source.id)
  )
    return null;
  if (
    !Array.isArray(source.participants) ||
    source.participants.length !== 2 ||
    !source.participants.every((p) => isRecord(p) && typeof p.name === "string")
  )
    return null;
  const home = source.participants.find((p) => p.isHome === true);
  const away = source.participants.find((p) => p !== home && p.isHome !== true);
  if (
    !home ||
    !away ||
    !home.name?.trim() ||
    !away.name?.trim() ||
    home.name === away.name
  )
    return null;
  if (identifier(home.teamId) !== null && home.teamId === away.teamId)
    return null;
  const data = isRecord(source.liveData) ? source.liveData : {};
  const scores = isRecord(data.score) ? data.score : {};
  const clock = isRecord(data.clock) ? data.clock : {};
  const startsAt =
    finite(source.startTime) && Math.abs(source.startTime) <= 8.64e15
      ? new Date(source.startTime).toISOString()
      : null;
  return {
    id: source.id,
    betradarId: identifier(source.betradarMatchId),
    home: { id: identifier(home.teamId)?.toString() ?? null, name: home.name },
    away: { id: identifier(away.teamId)?.toString() ?? null, name: away.name },
    competitionId: identifier(source.leagueId),
    categoryId: identifier(source.zoneId),
    startsAt,
    phase: source.isLive ? "live" : "prematch",
    isSuspended: source.isSuspended === true,
    homeScore: score(scores.home),
    awayScore: score(scores.away),
    clockSeconds:
      finite(clock.secondsSinceStart) && clock.secondsSinceStart >= 0
        ? clock.secondsSinceStart
        : null,
    clockStopped:
      typeof clock.clockStopped === "boolean" ? clock.clockStopped : null,
  };
}

// Substitute team names literally and capture only the numeric fields explicitly allowed by the catalog.
function context(
  definition: BetanoFootballMarketDefinition,
  market: BetanoMarket,
  event: BetanoFootballEvent,
): {
  interval: BetanoFootballInterval | null;
  scoreContext: BetanoFootballScoreContext | null;
} | null {
  if (typeof market.name !== "string") return null;
  if (
    definition.period !== "interval" &&
    !definition.nameTemplate.includes("{SCORE_HOME}")
  ) {
    const expected = definition.nameTemplate
      .replaceAll("{HOME}", event.home.name)
      .replaceAll("{AWAY}", event.away.name);
    return market.name === expected
      ? { interval: null, scoreContext: null }
      : null;
  }
  const tokens: string[] = [];
  let pattern = "";
  let previous = 0;
  for (const match of definition.nameTemplate.matchAll(
    /\{(HOME|AWAY|SCORE_HOME|SCORE_AWAY|FROM|TO)\}/g,
  )) {
    pattern += escape(definition.nameTemplate.slice(previous, match.index));
    const token = match[1]!;
    if (token === "HOME" || token === "AWAY")
      pattern += escape(event[token === "HOME" ? "home" : "away"].name);
    else {
      tokens.push(token);
      pattern +=
        token === "FROM" || token === "TO" ? "(\\d{2}:\\d{2})" : "(\\d+)";
    }
    previous = match.index + match[0].length;
  }
  pattern += escape(definition.nameTemplate.slice(previous));
  const match = new RegExp("^" + pattern + "$").exec(market.name);
  if (!match) return null;
  const values = new Map(tokens.map((token, i) => [token, match[i + 1]!]));
  let interval: BetanoFootballInterval | null = null;
  let scoreContext: BetanoFootballScoreContext | null = null;
  if (definition.period === "interval") {
    const parse = (label: string): number | null => {
      const [minutes, seconds] = label.split(":").map(Number);
      return minutes! <= 90 && seconds! <= 59 ? minutes! * 60 + seconds! : null;
    };
    const from = values.get("FROM"),
      to = values.get("TO");
    if (!from || !to || !definition.intervalMinutes) return null;
    const fromSecond = parse(from),
      toSecond = parse(to);
    if (
      fromSecond === null ||
      toSecond === null ||
      fromSecond % (definition.intervalMinutes * 60) !== 0 ||
      fromSecond >= 5400
    )
      return null;
    const end = fromSecond + definition.intervalMinutes * 60;
    const boundary = toSecond === end && (end === 2700 || end === 5400);
    if (toSecond !== end - 1 && !boundary) return null;
    interval = { fromSecond, toSecond, endsAtPeriodBoundary: boundary };
  }
  if (values.has("SCORE_HOME")) {
    const home = Number(values.get("SCORE_HOME")),
      away = Number(values.get("SCORE_AWAY"));
    if (!Number.isSafeInteger(home) || !Number.isSafeInteger(away)) return null;
    scoreContext = { home, away };
  }
  return { interval, scoreContext };
}

function matches(
  selection: BetanoSelection,
  outcome: BetanoFootballOutcomeDefinition,
  event: BetanoFootballEvent,
  aggregated: boolean,
): boolean {
  if (
    outcome.typeId !== undefined &&
    (!aggregated || selection.typeId !== undefined) &&
    selection.typeId !== outcome.typeId
  )
    return false;
  if (typeof selection.name !== "string") return false;
  const role = outcome.role;
  if (role === "yes" || role === "no")
    return (
      selection.name === outcome.label &&
      (selection.fullName === undefined || selection.fullName === outcome.label)
    );
  if (!finite(selection.handicap)) return false;
  if (role === "over" || role === "under") {
    const label = role === "over" ? "Peste" : "Sub";
    const prefix = label + " ";
    const value = selection.name.slice(prefix.length);
    return (
      selection.name.startsWith(prefix) &&
      decimal.test(value) &&
      Number(value) === selection.handicap &&
      (selection.fullName === undefined ||
        selection.fullName === label ||
        selection.fullName === selection.name)
    );
  }
  const team = event[role];
  const prefix = team.name + " ";
  const value = selection.name.slice(prefix.length);
  return (
    team.id !== null &&
    String(selection.teamId) === team.id &&
    selection.name.startsWith(prefix) &&
    decimal.test(value) &&
    Number(value) === selection.handicap &&
    (selection.fullName === undefined || selection.fullName === team.name)
  );
}

export function footballLines(
  market: BetanoMarket,
  snapshot: Pick<BetanoSnapshot, "selections">,
  event: BetanoFootballEvent,
  aggregated = false,
): Map<string, BetanoFootballLine> {
  const lines = new Map<string, BetanoFootballLine>();
  const definition = catalog.get(market.typeId ?? -1);
  if (
    !definition ||
    market.type !== definition.type ||
    !identifier(market.id) ||
    !Array.isArray(market.selectionIdList) ||
    new Set(market.selectionIdList).size !== market.selectionIdList.length
  )
    return lines;
  const metadata = context(definition, market, event);
  if (!metadata) return lines;
  const groups = new Map<
    string,
    { source: BetanoSelection; outcome: BetanoFootballOutcomeDefinition }[]
  >();
  const handicap = definition.kind.includes("handicap");
  const total =
    definition.kind === "total" || definition.kind === "asian-total";
  for (const id of market.selectionIdList) {
    const source = snapshot.selections[id];
    if (!source || source.id !== id || !identifier(id)) return lines;
    const outcome = definition.outcomes.find((o) =>
      matches(source, o, event, aggregated),
    );
    if (!outcome) return lines;
    const value = total
      ? source.handicap
      : handicap
        ? outcome.role === "away"
          ? -source.handicap!
          : source.handicap
        : null;
    if (
      (total && (!finite(value) || value < 0)) ||
      (handicap && !finite(value))
    )
      return lines;
    if (value !== null && (!finite(value) || !Number.isInteger(value * 4)))
      return lines;
    if (
      definition.kind === "total" &&
      value !== null &&
      !Number.isInteger(value * 2)
    )
      return lines;
    if (
      !aggregated &&
      (total || handicap) &&
      (!finite(market.handicap) || market.handicap !== value)
    )
      return lines;
    const key = value === null ? "binary" : String(normalized(value));
    const group = groups.get(key) ?? [];
    group.push({ source, outcome });
    groups.set(key, group);
  }
  for (const [groupKey, members] of groups) {
    if (members.length !== 2) continue;
    const ordered = definition.outcomes.map((o) =>
      members.filter((m) => m.outcome.role === o.role),
    );
    if (ordered.some((m) => m.length !== 1)) continue;
    const selections = ordered.map(([member]) => {
      const source = member!.source;
      return {
        id: String(source.id),
        outcomeId: identifier(source.typeId),
        role: member!.outcome.role,
        price: finite(source.price) && source.price > 1 ? source.price : null,
        isSuspended: source.isSuspended === true,
        handicap: total || handicap ? normalized(source.handicap!) : null,
      } satisfies BetanoFootballSelection;
    }) as [BetanoFootballSelection, BetanoFootballSelection];
    const key = `${market.id}:${groupKey}`;
    lines.set(key, {
      key,
      marketId: market.id,
      marketTypeId: definition.typeId,
      total: total ? Number(groupKey) : null,
      handicap: handicap ? Number(groupKey) : null,
      ...metadata,
      isSuspended: market.isSuspended === true,
      selections,
    });
  }
  return lines;
}
