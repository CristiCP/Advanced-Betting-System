import type { AggregationMarketMapping } from "../model/mapping.interfaces.js";
import type { TennisMarketMapping } from "../model/tennis-mapping.interfaces.js";
import type {
  AggregationTennisContext,
  TennisScoringEvent,
} from "../model/tennis.interfaces.js";
import { lineKey } from "../protocol/wire.js";
import { advantageTennisScore } from "../protocol/tennis.js";

/**
 * @file Builds tennis keys with explicit set coordinates and normalizes scoring notation.
 */

export function tennisLineKey(
  row: AggregationMarketMapping,
  kind: string,
  total: number | null,
  handicap: number | null,
  setNumber: number | null,
  gameNumber: number | null,
): number | null {
  if (
    gameNumber !== null ||
    (setNumber !== null && setNumber !== 1 && setNumber !== 2)
  )
    return null;
  const fixed = (row as TennisMarketMapping).setNumber;
  if (fixed !== undefined && setNumber !== fixed) return null;
  const variant = setNumber ?? 0;
  if (kind === "yes-no")
    return total === null && handicap === null
      ? lineKey(row.code, 0, variant)
      : null;
  const value =
    kind === "total" ? total : kind === "handicap" ? handicap : null;
  // Whole and quarter lines can push or split; the two-outcome payout formula does not model them.
  if (
    value === null ||
    !Number.isFinite(value) ||
    !Number.isInteger(value * 2) ||
    Number.isInteger(value)
  )
    return null;
  return lineKey(row.code, value * 4, variant);
}

export function tennisPoint(value: string | null): number | null {
  if (value === "A" || value === "AD") return advantageTennisScore;
  if (value === null || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const point = Number(value);
  return Number.isInteger(point) && point < advantageTennisScore ? point : null;
}

const boundedGames = (value: number | null): number | null =>
  value !== null &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < advantageTennisScore
    ? value
    : null;

export function tennisContext(
  event: TennisScoringEvent,
): AggregationTennisContext {
  const contiguous =
    event.sets.length <= 5 &&
    event.sets.every((set, i) => set.number === i + 1);
  const sets = contiguous
    ? event.sets.map(
        (set) =>
          [
            boundedGames(set.player1Games),
            boundedGames(set.player2Games),
          ] as const,
      )
    : [];
  const currentSet =
    event.currentSetNumber === undefined
      ? sets.length || null
      : event.currentSetNumber;
  return {
    sets,
    points: [
      tennisPoint(event.player1Points),
      tennisPoint(event.player2Points),
    ],
    server:
      event.serving === "player1" ? 1 : event.serving === "player2" ? 2 : 0,
    doubles:
      event.isDoubles === true ||
      event.player1.name.includes("/") ||
      event.player2.name.includes("/")
        ? 2
        : event.isDoubles === false
          ? 1
          : 0,
    currentSet:
      currentSet !== null &&
      Number.isInteger(currentSet) &&
      currentSet >= 1 &&
      currentSet <= 5
        ? currentSet
        : null,
  };
}
