export type FootballStatistic =
  | "goals"
  | "corners"
  | "yellow"
  | "red"
  | "shots"
  | "shots-on-target"
  | "fouls"
  | "offsides"
  | "throw-ins";

export type FootballStatisticsPeriod = "match" | "first-half" | "second-half";
export type FootballCounts = readonly [number | null, number | null];
export type FootballCounters = Partial<
  Record<FootballStatistic, FootballCounts>
>;
export type FootballStatistics = Partial<
  Record<FootballStatisticsPeriod, FootballCounters>
>;
export type FootballStatisticStatus = "equal" | "different" | "unknown";
export type FootballMarketChecks = Record<number, FootballStatisticStatus>;

export interface FootballStatisticsTarget {
  pairId: number;
  superbetId: number;
  betanoId: number;
}

export interface FootballStatisticsSample {
  target: FootballStatisticsTarget;
  superbet: { observedAt: number; counts: FootballStatistics } | null;
  betano: { observedAt: number; counts: FootballStatistics } | null;
}

export interface FootballStatisticsWatch {
  generation: number;
  superbetId: number;
  betanoId: number;
}

export interface FootballStatisticsView {
  generation: number;
  checks: FootballMarketChecks;
}
