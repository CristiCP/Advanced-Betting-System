import type { BetanoPrematchFootballEvent } from "../model/football-prematch.interfaces.js";
import type { BetanoFootballSnapshot } from "../model/football-projection.interfaces.js";
import type {
  BetanoEvent,
  BetanoMarket,
  BetanoSelection,
} from "../model/state.interfaces.js";
import { footballEvent, footballLines } from "./football-markets.js";

/**
 * @file Projects an already extracted public prematch event without starting another feed.
 */

const numericId = (value: string): number =>
  /^\d+$/.test(value) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) > 0
    ? Number(value)
    : NaN;

// Prematch HTML aggregates several thresholds under one market and omits outcome type IDs.
export function projectPrematchFootball(
  source: BetanoPrematchFootballEvent,
  projectedAt = Date.now(),
): BetanoFootballSnapshot | null {
  if (
    source.sportId !== "FOOT" ||
    !Array.isArray(source.participants) ||
    source.participants.length !== 2 ||
    !Array.isArray(source.markets)
  )
    return null;
  const event: BetanoEvent = {
    id: numericId(source.id),
    sportId: "FOOT",
    isLive: false,
    marketIdList: [],
    participants: source.participants.map((p, i) => ({
      name: p.name,
      teamId: numericId(p.id),
      isHome: i === 0,
    })),
    ...(source.startTime === undefined ? {} : { startTime: source.startTime }),
    ...(source.leagueId === undefined
      ? {}
      : { leagueId: numericId(source.leagueId) }),
    ...(source.regionId === undefined
      ? {}
      : { zoneId: numericId(source.regionId) }),
  };
  const context = footballEvent({ event });
  if (!context) return null;
  const lines: BetanoFootballSnapshot["lines"] = [];
  const seen = new Map<number, string>();
  const selectionIds = new Set<number>();
  for (const raw of source.markets) {
    const id = numericId(raw.id);
    if (!Number.isSafeInteger(id) || !Array.isArray(raw.selections))
      return null;
    // The HTML repeats the same market in several tabs; reject conflicting copies.
    const fingerprint = JSON.stringify([
      raw.typeId,
      raw.type,
      raw.name,
      raw.handicap,
      raw.isSuspended,
      raw.selections.map((s) => [
        s.id,
        s.name,
        s.fullName,
        s.price,
        s.handicap,
        s.teamId,
        s.isSuspended,
      ]),
    ]);
    const previous = seen.get(id);
    if (previous !== undefined) {
      if (previous !== fingerprint) return null;
      continue;
    }
    seen.set(id, fingerprint);
    const selections: Record<string, BetanoSelection> = {};
    for (const item of raw.selections) {
      const selectionId = numericId(item.id);
      if (!Number.isSafeInteger(selectionId) || selectionIds.has(selectionId))
        return null;
      selectionIds.add(selectionId);
      selections[selectionId] = {
        ...item,
        id: selectionId,
        ...(item.teamId === undefined
          ? {}
          : { teamId: numericId(item.teamId) }),
      } as BetanoSelection;
    }
    const market: BetanoMarket = {
      id,
      type: raw.type,
      typeId: raw.typeId,
      name: raw.name,
      selectionIdList: Object.values(selections).map((s) => s.id),
      ...(raw.handicap === undefined ? {} : { handicap: raw.handicap }),
      ...(raw.isSuspended === undefined
        ? {}
        : { isSuspended: raw.isSuspended }),
    };
    lines.push(
      ...footballLines(market, { selections }, context, true).values(),
    );
  }
  return {
    provider: "betano",
    event: context,
    sourceVersion: null,
    projectedAt,
    lines,
  };
}
