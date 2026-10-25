import { betanoTennisMarkets } from "../tennis-markets.config.js";
import type {
  BetanoTennisMarketDefinition,
  BetanoTennisOutcomeDefinition,
} from "../model/tennis-markets.interfaces.js";
import type {
  BetanoTennisEvent,
  BetanoTennisLine,
  BetanoTennisPlayer,
  BetanoTennisSelection,
  BetanoTennisSetScore,
} from "../model/tennis-projection.interfaces.js";
import type {
  BetanoMarket,
  BetanoParticipant,
  BetanoSelection,
  BetanoSnapshot,
} from "../model/state.interfaces.js";
import { isRecord } from "./state.js";

/**
 * @file Validates tennis identities, scoring context, and fixed two-outcome market templates.
 */

const catalog = new Map<number, BetanoTennisMarketDefinition>(
  betanoTennisMarkets.map((definition) => [definition.typeId, definition]),
);
const decimal = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const normalized = (value: number): number => (value === 0 ? 0 : value);
const identifier = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : null;
const escape = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

function player(source: BetanoParticipant): BetanoTennisPlayer | null {
  const ids = source.playerIds;
  if (
    ids !== undefined &&
    (!Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 2 ||
      ids.some((id) => identifier(id) === null) ||
      new Set(ids).size !== ids.length)
  )
    return null;
  return {
    id: identifier(source.teamId)?.toString() ?? null,
    name: source.name,
    playerIds: ids === undefined ? [] : ([...ids] as number[]),
  };
}

// Set scores are positional in this vendor; do not infer a match-tiebreak format from them.
function setScores(value: unknown): BetanoTennisSetScore[] {
  if (!Array.isArray(value) || value.length > 5) return [];
  if (value.some((set) => !isRecord(set))) return [];
  return value.map((set, i) => ({
    number: i + 1,
    player1Games: score(set.home),
    player2Games: score(set.away),
  }));
}

export function tennisEvent(
  snapshot: Pick<BetanoSnapshot, "event">,
): BetanoTennisEvent | null {
  const source = snapshot.event;
  if (
    source.sportId !== "TENN" ||
    source.isEnded === true ||
    typeof source.isLive !== "boolean" ||
    identifier(source.id) === null
  )
    return null;
  if (
    !Array.isArray(source.participants) ||
    source.participants.length !== 2 ||
    !source.participants.every((p) => isRecord(p) && typeof p.name === "string")
  )
    return null;
  const homes = source.participants.filter((p) => p.isHome === true);
  if (homes.length !== 1) return null;
  const home = homes[0]!,
    away = source.participants.find((p) => p !== home)!;
  if (
    !home.name.trim() ||
    !away.name.trim() ||
    home.name === away.name ||
    (identifier(home.teamId) !== null && home.teamId === away.teamId)
  )
    return null;
  const player1 = player(home),
    player2 = player(away);
  if (
    !player1 ||
    !player2 ||
    player1.playerIds.some((id) => player2.playerIds.includes(id))
  )
    return null;
  const data = isRecord(source.liveData) ? source.liveData : {};
  const results = isRecord(data.results) ? data.results : {};
  const pointScore = isRecord(data.score) ? data.score : {};
  const set = identifier(results.currentPeriodNumber);
  const game =
    typeof results.currentGame === "string"
      ? /^Game ([1-9]\d*)$/.exec(results.currentGame)
      : null;
  const currentSetNumber = set !== null && set <= 5 ? set : null;
  const currentGameNumber =
    currentSetNumber === null || !game ? null : identifier(Number(game[1]));
  const startsAt =
    finite(source.startTime) && Math.abs(source.startTime) <= 8.64e15
      ? new Date(source.startTime).toISOString()
      : null;
  return {
    id: source.id,
    betradarId: identifier(source.betradarMatchId),
    player1,
    player2,
    competitionId: identifier(source.leagueId),
    categoryId: identifier(source.zoneId),
    startsAt,
    phase: source.isLive ? "live" : "prematch",
    isSuspended: source.isSuspended === true,
    isDoubles:
      typeof source.isTennisDoubles === "boolean"
        ? source.isTennisDoubles
        : null,
    player1Sets: score(results.liveInfoHomeScore),
    player2Sets: score(results.liveInfoAwayScore),
    player1Points: points(pointScore.home),
    player2Points: points(pointScore.away),
    serving:
      results.serverHome === true && results.serverAway !== true
        ? "player1"
        : results.serverAway === true && results.serverHome !== true
          ? "player2"
          : null,
    currentSetNumber,
    currentGameNumber,
    sets: setScores(results.setScoreList),
  };
}

// Numeric coordinates are captured only where a catalog template explicitly allows them.
function context(
  definition: BetanoTennisMarketDefinition,
  market: BetanoMarket,
  event: BetanoTennisEvent,
): number | null | false {
  if (typeof market.name !== "string") return false;
  const expected = definition.nameTemplate
    .replaceAll("<PLAYER_1>", () => event.player1.name)
    .replaceAll("<PLAYER_2>", () => event.player2.name);
  if (!expected.includes("<SET>"))
    return market.name === expected ? (definition.setNumber ?? null) : false;
  const pattern = escape(expected).replace("<SET>", "([1-5])");
  const match = new RegExp("^" + pattern + "$").exec(market.name);
  return match ? Number(match[1]) : false;
}

function matches(
  selection: BetanoSelection,
  outcome: BetanoTennisOutcomeDefinition,
  event: BetanoTennisEvent,
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
  if (role === "yes" || role === "no") {
    const label = role === "yes" ? "Da" : "Nu";
    return (
      selection.name === label &&
      (selection.fullName === undefined || selection.fullName === label) &&
      (selection.handicap === undefined || selection.handicap === 0)
    );
  }
  if (!finite(selection.handicap)) return false;
  const label =
    role === "over" ? "Peste" : role === "under" ? "Sub" : event[role].name;
  const prefix = label + " ";
  const value = selection.name.slice(prefix.length);
  return (
    selection.name.startsWith(prefix) &&
    decimal.test(value) &&
    Number(value) === selection.handicap &&
    (selection.fullName === undefined ||
      selection.fullName === label ||
      ((role === "over" || role === "under") &&
        selection.fullName === selection.name))
  );
}

export function tennisLines(
  market: BetanoMarket,
  snapshot: Pick<BetanoSnapshot, "selections">,
  event: BetanoTennisEvent,
  aggregated = false,
): Map<string, BetanoTennisLine> {
  const lines = new Map<string, BetanoTennisLine>();
  const definition = catalog.get(market.typeId ?? -1);
  if (
    !definition ||
    market.type !== definition.type ||
    identifier(market.id) === null ||
    !Array.isArray(market.selectionIdList) ||
    new Set(market.selectionIdList).size !== market.selectionIdList.length
  )
    return lines;
  const setNumber = context(definition, market, event);
  if (setNumber === false) return lines;
  const groups = new Map<
    string,
    { source: BetanoSelection; outcome: BetanoTennisOutcomeDefinition }[]
  >();
  const total = definition.kind === "total",
    handicap = definition.kind === "handicap";
  for (const id of market.selectionIdList) {
    const source = snapshot.selections[id];
    if (!source || source.id !== id || identifier(id) === null) return lines;
    const outcome = definition.outcomes.find((outcome) =>
      matches(source, outcome, event, aggregated),
    );
    if (!outcome) return lines;
    const value = total
      ? source.handicap
      : handicap
        ? outcome.role === "player2"
          ? -source.handicap!
          : source.handicap
        : null;
    if (
      value !== null &&
      (!finite(value) || !Number.isInteger(value * 2) || (total && value < 0))
    )
      return lines;
    if (
      !aggregated &&
      (total || handicap) &&
      (!finite(market.handicap) || market.handicap !== value)
    )
      return lines;
    const key = value === null ? "binary" : String(normalized(value!));
    const group = groups.get(key) ?? [];
    group.push({ source, outcome });
    groups.set(key, group);
  }
  for (const [groupKey, members] of groups) {
    // Include suspended members in cardinality; they cannot disappear to make a pair.
    if (members.length !== 2) continue;
    const ordered = definition.outcomes.map((outcome) =>
      members.filter((member) => member.outcome.role === outcome.role),
    );
    if (ordered.some((group) => group.length !== 1)) continue;
    const selections = ordered.map(([member]) => {
      const source = member!.source;
      return {
        id: String(source.id),
        outcomeId: identifier(source.typeId),
        role: member!.outcome.role,
        price: finite(source.price) && source.price > 1 ? source.price : null,
        isSuspended: source.isSuspended === true,
        handicap: total || handicap ? normalized(source.handicap!) : null,
      } satisfies BetanoTennisSelection;
    }) as [BetanoTennisSelection, BetanoTennisSelection];
    const key = `${market.id}:${groupKey}`;
    lines.set(key, {
      key,
      marketId: market.id,
      marketTypeId: definition.typeId,
      total: total ? Number(groupKey) : null,
      handicap: handicap ? Number(groupKey) : null,
      setNumber,
      gameNumber: null,
      isSuspended: market.isSuspended === true,
      selections,
    });
  }
  return lines;
}
