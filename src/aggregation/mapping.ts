import { footballMarketMapping } from "./mapping.config.js";
import type {
  AggregationCatalogDefinition,
  AggregationMappingCondition,
  AggregationMarketMapping,
} from "./model/mapping.interfaces.js";
import type { AggregationProvider } from "./model/wire.interfaces.js";

/**
 * @file Validates the cross-book market mapping and indexes enabled rows per provider.
 */

export const mappingConditions: readonly AggregationMappingCondition[] = [
  "D",
  "P",
  "A",
  "H",
  "I",
  "T",
];

// Role A is the first side of every two-outcome line; matching is by meaning, never by position.
const roleA = new Set(["over", "home", "player1", "yes"]);
const roleB = new Set(["under", "away", "player2", "no"]);
const totalKinds = new Set(["total", "asian-total"]);
const handicapKinds = new Set(["handicap", "asian-handicap"]);

export function isCondition(
  value: unknown,
): value is AggregationMappingCondition {
  return mappingConditions.includes(value as AggregationMappingCondition);
}

const isQuarter = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && Number.isInteger(value * 4);

function sides(definition: AggregationCatalogDefinition): boolean {
  const [first, second] = definition.outcomes.map((outcome) => outcome.role);
  return (
    (roleA.has(first!) && roleB.has(second!)) ||
    (roleB.has(first!) && roleA.has(second!))
  );
}

// Superbet parameters must be exactly what the canonical line needs; xnr is never mapped.
function expectedParameters(
  definition: AggregationCatalogDefinition,
): string[] {
  const parameters: string[] = [];
  if (totalKinds.has(definition.kind)) parameters.push("total");
  if (handicapKinds.has(definition.kind)) parameters.push("hcp");
  if (definition.period === "interval") parameters.push("from", "to");
  return parameters;
}

// Return every inconsistency instead of the first one, so a catalog change shows its full impact.
export function validateMapping(
  mapping: readonly AggregationMarketMapping[],
  superbet: ReadonlyMap<number, AggregationCatalogDefinition>,
  betano: ReadonlyMap<number, AggregationCatalogDefinition>,
): string[] {
  const errors: string[] = [];
  const codes = new Set<number>();
  const pairs = new Set<string>();
  for (const row of mapping) {
    const label = `mapping ${row.code} (${row.betano}/${row.superbet})`;
    if (!Number.isInteger(row.code) || row.code < 1 || row.code > 4095)
      errors.push(`${label}: code must be an integer in 1..4095.`);
    if (codes.has(row.code)) errors.push(`${label}: duplicate code.`);
    codes.add(row.code);
    const pair = `${row.betano}/${row.superbet}/${row.threshold ?? ""}`;
    if (pairs.has(pair)) errors.push(`${label}: duplicate pair.`);
    pairs.add(pair);
    if (
      row.conditions.length === 0 ||
      !row.conditions.every(isCondition) ||
      new Set(row.conditions).size !== row.conditions.length ||
      (row.conditions.includes("D") && row.conditions.length !== 1)
    )
      errors.push(`${label}: invalid conditions.`);
    const threshold = row.conditions.includes("T");
    if (threshold !== (row.threshold !== undefined))
      errors.push(`${label}: a threshold is required exactly with T.`);
    if (row.threshold !== undefined && !isQuarter(row.threshold))
      errors.push(`${label}: threshold must be a non-negative quarter.`);
    const left = superbet.get(row.superbet);
    const right = betano.get(row.betano);
    if (!left || !right) {
      errors.push(`${label}: market type is missing from a catalog.`);
      continue;
    }
    for (const field of ["statistic", "period", "subject"] as const)
      if (left[field] !== right[field])
        errors.push(`${label}: ${field} differs.`);
    if (left.intervalMinutes !== right.intervalMinutes)
      errors.push(`${label}: interval length differs.`);
    if ((left.period === "interval") !== row.conditions.includes("I"))
      errors.push(`${label}: interval markets require I.`);
    if (!sides(left) || !sides(right))
      errors.push(`${label}: outcomes are not one A and one B role.`);
    // T maps Betano yes/no to a Superbet line at the threshold: a total, or a yes/no with a total parameter.
    if (threshold) {
      if (
        right.kind !== "yes-no" ||
        (left.kind !== "total" && left.kind !== "yes-no")
      )
        errors.push(`${label}: T maps Betano yes/no to a Superbet total.`);
    } else if (left.kind !== right.kind)
      errors.push(`${label}: market kinds differ.`);
    const parameters = threshold ? ["total"] : expectedParameters(left);
    if (
      left.parameters === undefined ||
      left.parameters.length !== parameters.length ||
      !parameters.every((parameter) => left.parameters!.includes(parameter))
    )
      errors.push(`${label}: Superbet parameters do not match the kind.`);
  }
  return errors;
}

export function isRoleA(role: string): boolean {
  return roleA.has(role);
}

// Index enabled rows by the provider's own market type; a type can feed several rows (T thresholds).
export function mappingIndex(
  provider: AggregationProvider,
  enabled: readonly AggregationMappingCondition[],
  mapping: readonly AggregationMarketMapping[] = footballMarketMapping,
): Map<number, AggregationMarketMapping[]> {
  const allowed = new Set(enabled);
  const index = new Map<number, AggregationMarketMapping[]>();
  for (const row of mapping) {
    if (!row.conditions.every((condition) => allowed.has(condition))) continue;
    if (row.enabled === false) continue;
    const id = row[provider];
    const rows = index.get(id);
    if (rows) rows.push(row);
    else index.set(id, [row]);
  }
  return index;
}
