import { tennisMarketMapping } from "./tennis-mapping.config.js";
import { superbetTennisMarkets } from "../providers/superbet/tennis-markets.config.js";
import { betanoTennisMarkets } from "../providers/betano/tennis-markets.config.js";
import type { TennisMarketMapping } from "./model/tennis-mapping.interfaces.js";
import { isCondition, isRoleA } from "./mapping.js";
import { footballMarketMapping } from "./mapping.config.js";

/**
 * @file Rejects tennis mappings whose concepts, periods, parameters or participant roles disagree.
 */

export function validateTennisMapping(
  rows: readonly TennisMarketMapping[] = tennisMarketMapping,
): string[] {
  const left = new Map<number, (typeof superbetTennisMarkets)[number]>(
    superbetTennisMarkets.map((m) => [m.id, m]),
  );
  const right = new Map<number, (typeof betanoTennisMarkets)[number]>(
    betanoTennisMarkets.map((m) => [m.typeId, m]),
  );
  const codes = new Set(footballMarketMapping.map((row) => row.code)),
    pairs = new Set<string>(),
    errors: string[] = [];
  for (const row of rows) {
    const label = `tennis mapping ${row.code}`;
    if (
      !Number.isInteger(row.code) ||
      row.code < 1001 ||
      row.code > 4095 ||
      codes.has(row.code)
    )
      errors.push(`${label}: invalid or duplicate code.`);
    codes.add(row.code);
    const pair = `${row.superbet}:${row.betano}`;
    if (pairs.has(pair)) errors.push(`${label}: duplicate pair.`);
    pairs.add(pair);
    if (
      !row.conditions.length ||
      !row.conditions.every(isCondition) ||
      row.conditions.some((c) => c !== "D" && c !== "P") ||
      new Set(row.conditions).size !== row.conditions.length ||
      (row.conditions.includes("D") && row.conditions.length !== 1) ||
      (row.enabled !== undefined && typeof row.enabled !== "boolean") ||
      row.threshold !== undefined
    )
      errors.push(`${label}: invalid conditions.`);
    const a = left.get(row.superbet),
      b = right.get(row.betano);
    if (!a || !b) {
      errors.push(`${label}: missing market.`);
      continue;
    }
    for (const field of ["kind", "statistic", "period", "subject"] as const)
      if (a[field] !== b[field]) errors.push(`${label}: ${field} differs.`);
    for (const definition of [a, b])
      if (definition.outcomes.filter((o) => isRoleA(o.role)).length !== 1)
        errors.push(`${label}: incompatible roles.`);
    if (
      a.outcomes
        .map((o) => o.role)
        .sort()
        .join(",") !==
      b.outcomes
        .map((o) => o.role)
        .sort()
        .join(",")
    )
      errors.push(`${label}: outcome roles differ.`);
    const params = [...a.parameters].sort().join(",");
    const expected = [
      ...(a.kind === "total"
        ? ["total"]
        : a.kind === "handicap"
          ? ["hcp"]
          : []),
      ...(a.period === "set" ? ["setnr"] : []),
    ]
      .sort()
      .join(",");
    if (params !== expected || (a.period !== "set" && a.period !== "match"))
      errors.push(`${label}: unsupported parameters.`);
    const fixed = "setNumber" in b ? b.setNumber : undefined;
    if (
      row.setNumber !== fixed ||
      (row.setNumber !== undefined && row.setNumber !== 1)
    )
      errors.push(`${label}: fixed set differs.`);
  }
  return errors;
}
