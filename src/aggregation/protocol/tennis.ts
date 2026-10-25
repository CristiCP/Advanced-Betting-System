import type { AggregationTennisContext } from "../model/tennis.interfaces.js";

/**
 * @file Validates compact tennis context and compares only explicitly known scoring states.
 */

export const unknownTennisScore = 0xffff;
export const advantageTennisScore = 0xfffe;
export const tennisContextBytes = 32;
const score = (value: unknown, advantage = false): boolean =>
  value === null ||
  (typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < (advantage ? 0xffff : 0xfffe));

export function isTennisContext(value: AggregationTennisContext): boolean {
  if (!value || typeof value !== "object") return false;
  return (
    Array.isArray(value.sets) &&
    value.sets.length <= 5 &&
    value.sets.every(
      (set) =>
        Array.isArray(set) && set.length === 2 && set.every((v) => score(v)),
    ) &&
    Array.isArray(value.points) &&
    value.points.length === 2 &&
    value.points.every((v) => score(v, true)) &&
    [0, 1, 2].includes(value.server) &&
    [0, 1, 2].includes(value.doubles) &&
    (value.currentSet === null ||
      (Number.isInteger(value.currentSet) &&
        value.currentSet >= 1 &&
        value.currentSet <= 5))
  );
}

export function sameTennisContext(
  a: AggregationTennisContext | undefined,
  b: AggregationTennisContext | undefined,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.server === b.server &&
      a.doubles === b.doubles &&
      a.currentSet === b.currentSet &&
      a.points[0] === b.points[0] &&
      a.points[1] === b.points[1] &&
      a.sets.length === b.sets.length &&
      a.sets.every(
        (set, i) => set[0] === b.sets[i]![0] && set[1] === b.sets[i]![1],
      ))
  );
}

export function tennisContextAgrees(
  a: AggregationTennisContext | undefined,
  b: AggregationTennisContext | undefined,
): boolean {
  if (
    !a ||
    !b ||
    !a.currentSet ||
    a.currentSet !== b.currentSet ||
    a.sets.length !== a.currentSet ||
    b.sets.length !== b.currentSet ||
    a.server === 0 ||
    a.server !== b.server ||
    (a.doubles !== 0 && b.doubles !== 0 && a.doubles !== b.doubles)
  )
    return false;
  return (
    a.points.every((point, i) => point !== null && point === b.points[i]) &&
    a.sets.every((set, i) =>
      set.every((games, side) => games !== null && games === b.sets[i]![side]),
    )
  );
}

export function writeTennisContext(
  view: DataView,
  offset: number,
  value: AggregationTennisContext,
): void {
  view.setUint8(offset, value.sets.length);
  view.setUint8(offset + 1, value.currentSet ?? 0);
  view.setUint8(offset + 2, value.server);
  view.setUint8(offset + 3, value.doubles);
  view.setUint16(offset + 4, value.points[0] ?? unknownTennisScore, true);
  view.setUint16(offset + 6, value.points[1] ?? unknownTennisScore, true);
  for (let i = 0; i < 5; i++) {
    view.setUint16(
      offset + 8 + i * 4,
      value.sets[i]?.[0] ?? unknownTennisScore,
      true,
    );
    view.setUint16(
      offset + 10 + i * 4,
      value.sets[i]?.[1] ?? unknownTennisScore,
      true,
    );
  }
  view.setUint32(offset + 28, 0, true);
}

export function readTennisContext(
  view: DataView,
  offset: number,
): AggregationTennisContext | null {
  const length = view.getUint8(offset);
  if (length > 5 || view.getUint32(offset + 28, true) !== 0) return null;
  const get = (at: number): number | null => {
    const value = view.getUint16(at, true);
    return value === unknownTennisScore ? null : value;
  };
  for (let i = length; i < 5; i++)
    if (get(offset + 8 + i * 4) !== null || get(offset + 10 + i * 4) !== null)
      return null;
  const result: AggregationTennisContext = {
    currentSet: view.getUint8(offset + 1) || null,
    server: view.getUint8(offset + 2) as 0 | 1 | 2,
    doubles: view.getUint8(offset + 3) as 0 | 1 | 2,
    points: [get(offset + 4), get(offset + 6)],
    sets: Array.from(
      { length },
      (_, i) => [get(offset + 8 + i * 4), get(offset + 10 + i * 4)] as const,
    ),
  };
  return isTennisContext(result) ? result : null;
}
