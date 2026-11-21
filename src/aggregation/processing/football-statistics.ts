import { superbetFootballMarkets } from "../../providers/superbet/football-markets.config.js";
import { footballMarketMapping } from "../mapping.config.js";
import { footballStatisticsConfig } from "../football-statistics.config.js";
import type { AggregationPair } from "../model/matching.interfaces.js";
import type {
  FootballCounts,
  FootballStatisticsPeriod,
  FootballStatisticsSample,
  FootballStatistic,
  FootballStatisticStatus,
} from "../model/football-statistics.interfaces.js";

/** @file Checks the counters a football market uses, within its scope and period. */

const catalog = new Map(
  superbetFootballMarkets.map((market) => [market.id, market]),
);
const roles = {
  home: [0],
  away: [1],
  both: [0, 1],
  total: [0, 1],
} as const;
const counters = {
  goals: ["goals"],
  corners: ["corners"],
  cards: ["yellow", "red"],
  "red-cards": ["red"],
  shots: ["shots"],
  "shots-on-target": ["shots-on-target"],
  fouls: ["fouls"],
  offsides: ["offsides"],
  "throw-ins": ["throw-ins"],
} as const satisfies Partial<Record<string, readonly FootballStatistic[]>>;

// These markets use the score in each half or need both teams to determine the winner.
const bothHalves = new Set([200794, 200811, 200821, 200830, 232509]);
const bothTeams = new Set([200794, 200830, 232513, 232514]);
const markets = new Map(
  footballMarketMapping.flatMap((row) => {
    const definition = catalog.get(row.superbet);
    if (!definition) return [];
    const { statistic, kind, subject, period } = definition;
    const stats: readonly FootballStatistic[] =
      counters[statistic as keyof typeof counters] ?? [];
    const periods: readonly FootballStatisticsPeriod[] = bothHalves.has(
      row.superbet,
    )
      ? ["match", "first-half", "second-half"]
      : period === "match" ||
          period === "first-half" ||
          period === "second-half"
        ? [period]
        : [];
    const teams =
      roles[
        kind === "handicap" ||
        kind === "asian-handicap" ||
        bothTeams.has(row.superbet)
          ? "both"
          : subject
      ];
    return [
      [
        row.code,
        { stats, periods, teams, goals: statistic === "goals" },
      ] as const,
    ];
  }),
);

export const checksGoals = (code: number): boolean =>
  markets.get(code)?.goals === true;

export function needsFootballStatistics(code: number): boolean {
  const market = markets.get(code);
  return (
    market !== undefined &&
    market.stats.length > 0 &&
    !(
      market.goals &&
      market.periods.length === 1 &&
      market.periods[0] === "match"
    ) &&
    market.periods.length > 0
  );
}

export function footballStatisticsExpires(
  sample: FootballStatisticsSample,
): number {
  if (!sample.superbet || !sample.betano) return 0;
  return (
    Math.min(sample.superbet.observedAt, sample.betano.observedAt) +
    footballStatisticsConfig.maxAgeMs
  );
}

export function supplementaryFootballStatus(
  code: number,
  sample: FootballStatisticsSample | undefined,
  now: number,
): FootballStatisticStatus {
  const market = markets.get(code);
  if (
    !market ||
    !sample?.superbet ||
    !sample.betano ||
    now >= footballStatisticsExpires(sample)
  )
    return "unknown";
  let known = false;
  let missing = false;
  for (const period of market.periods) {
    const left = sample.superbet.counts[period];
    const right = sample.betano.counts[period];
    for (const statistic of market.stats) {
      if (statistic === "goals" && period === "match") continue;
      const result = compare(
        left?.[statistic],
        right?.[statistic],
        market.teams,
      );
      if (result === "different") return result;
      if (result === "equal") known = true;
      else missing = true;
    }
  }
  return known && !missing ? "equal" : "unknown";
}

export function footballStatisticStatus(
  code: number,
  pair: AggregationPair,
  sample: FootballStatisticsSample | undefined,
  now: number,
): FootballStatisticStatus {
  const market = markets.get(code);
  if (!market) return "unknown";
  const supplemental = supplementaryFootballStatus(code, sample, now);
  if (
    supplemental === "different" ||
    !market.goals ||
    market.periods.length === 0
  )
    return supplemental;
  const { superbet, betano } = pair;
  const goals = compare(
    superbet.scoreKnown ? [superbet.homeScore, superbet.awayScore] : undefined,
    betano.scoreKnown ? [betano.homeScore, betano.awayScore] : undefined,
    market.teams,
  );
  if (goals === "different") return goals;
  if (!market.periods.includes("match")) return supplemental;
  if (market.periods.length === 1) return goals;
  return goals === "equal" && supplemental === "equal" ? "equal" : "unknown";
}

function compare(
  left: FootballCounts | undefined,
  right: FootballCounts | undefined,
  teams: readonly (0 | 1)[],
): FootballStatisticStatus {
  let missing = false;
  for (const team of teams) {
    const a = left?.[team];
    const b = right?.[team];
    if (a == null || b == null) missing = true;
    else if (a !== b) return "different";
  }
  return missing ? "unknown" : "equal";
}
