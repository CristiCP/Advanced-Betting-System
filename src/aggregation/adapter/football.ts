import type { AggregationMarketMapping } from "../model/mapping.interfaces.js";
import { lineKey } from "../protocol/wire.js";
export { ProjectionAggregationAdapter as FootballAggregationAdapter } from "./projection.js";

/**
 * @file Builds canonical football line keys and preserves the existing adapter export.
 */

const totalKinds = new Set(["total", "asian-total"]);
const handicapKinds = new Set(["handicap", "asian-handicap"]);

// Canonical key of one vendor line under one mapping row, or null when the row does not apply.
export function footballLineKey(
  row: AggregationMarketMapping,
  kind: string,
  side: "superbet" | "betano",
  total: number | null,
  handicap: number | null,
  variant: number,
): number | null {
  if (row.threshold !== undefined) {
    // Betano answers yes/no without a line; Superbet must quote exactly the threshold.
    if (side === "betano" ? total !== null : total !== row.threshold)
      return null;
    return lineKey(row.code, row.threshold * 4, variant);
  }
  if (totalKinds.has(kind))
    return total === null ? null : lineKey(row.code, total * 4, variant);
  if (handicapKinds.has(kind))
    return handicap === null ? null : lineKey(row.code, handicap * 4, variant);
  if (kind === "yes-no" && total === null && handicap === null)
    return lineKey(row.code, 0, variant);
  return null;
}
