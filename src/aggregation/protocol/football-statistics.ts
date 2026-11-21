import type {
  FootballCounts,
  FootballStatistic,
  FootballStatistics,
  FootballStatisticsPeriod,
} from "../model/football-statistics.interfaces.js";
import { isRecord } from "./validation.js";

/** @file Reads only named, non-negative counters from the two public statistics responses. */

const scorealarm = new Map<string, FootballStatistic>([
  ["corner_kicks", "corners"],
  ["yellow_cards", "yellow"],
  ["red_cards", "red"],
  ["shots", "shots"],
  ["shots_on_goal", "shots-on-target"],
  ["fouls", "fouls"],
  ["offsides", "offsides"],
  ["throw_ins", "throw-ins"],
]);
const statsStream = new Map<string, FootballStatistic>([
  ["goals", "goals"],
  ["corners", "corners"],
  ["yellow_cards", "yellow"],
  ["red_cards", "red"],
  ["total_shots", "shots"],
  ["shots_on_target", "shots-on-target"],
  ["fouls", "fouls"],
  ["offsides", "offsides"],
  ["throw_ins", "throw-ins"],
]);
const scorealarmPeriods = ["match", "first-half", "second-half"] as const;
const statsStreamPeriods = {
  match: "regular_time",
  "first-half": "first_half",
  "second-half": "second_half",
} as const;

function count(value: unknown): number | null {
  const n =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function scorealarmStatistics(value: unknown): FootballStatistics {
  const result: FootballStatistics = {};
  if (!isRecord(value)) return result;
  const rows = Array.isArray(value.match_stats) ? value.match_stats : [];
  const hasExtraTime = rows.some(
    (row) => isRecord(row) && (row.period === 3 || row.period === 4),
  );
  for (const row of rows) {
    if (!isRecord(row) || !isRecord(row.text) || !Array.isArray(row.text.args))
      continue;
    const label: unknown = row.text.args[0];
    const period =
      typeof row.period === "number"
        ? scorealarmPeriods[row.period]
        : undefined;
    const prefix = "stats.football.match.";
    const statistic =
      typeof label === "string" && label.startsWith(prefix)
        ? scorealarm.get(label.slice(prefix.length))
        : undefined;
    if (!statistic || !period || (period === "match" && hasExtraTime)) continue;
    (result[period] ??= {})[statistic] = [count(row.team1), count(row.team2)];
  }
  if (Array.isArray(value.scores))
    for (const row of value.scores) {
      if (!isRecord(row) || (row.type !== 1 && row.type !== 2)) continue;
      const period = scorealarmPeriods[row.type];
      (result[period] ??= {}).goals = [count(row.team1), count(row.team2)];
    }
  if (hasExtraTime) {
    for (const statistic of scorealarm.values()) {
      const first = result["first-half"]?.[statistic];
      const second = result["second-half"]?.[statistic];
      if (!first || !second) continue;
      const total: FootballCounts = [
        first[0] === null || second[0] === null ? null : first[0] + second[0],
        first[1] === null || second[1] === null ? null : first[1] + second[1],
      ];
      (result.match ??= {})[statistic] = total;
    }
  }
  return result;
}

export function statsStreamStatistics(value: unknown): FootballStatistics {
  const result: FootballStatistics = {};
  if (!isRecord(value) || !isRecord(value.data)) return result;
  const { home, away } = value.data;
  for (const period of Object.keys(
    statsStreamPeriods,
  ) as FootballStatisticsPeriod[]) {
    const key = statsStreamPeriods[period];
    const left = isRecord(home) ? home[key] : null;
    const right = isRecord(away) ? away[key] : null;
    for (const [field, statistic] of statsStream) {
      const a = isRecord(left) ? count(left[field]) : null;
      const b = isRecord(right) ? count(right[field]) : null;
      if (a !== null || b !== null) (result[period] ??= {})[statistic] = [a, b];
    }
  }
  return result;
}
