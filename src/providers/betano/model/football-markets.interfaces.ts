export type BetanoFootballMarketKind =
  | "total"
  | "asian-total"
  | "handicap"
  | "asian-handicap"
  | "yes-no";

export type BetanoFootballStatistic =
  | "goals"
  | "corners"
  | "cards"
  | "red-cards"
  | "shots"
  | "shots-on-target"
  | "fouls"
  | "offsides"
  | "throw-ins"
  | "goal-kicks"
  | "penalties"
  | "own-goals"
  | "woodwork";
export type BetanoFootballPeriod =
  | "match"
  | "first-half"
  | "second-half"
  | "interval";
export type BetanoFootballSubject = "total" | "home" | "away" | "both";
export type BetanoFootballOutcome =
  | "over"
  | "under"
  | "home"
  | "away"
  | "yes"
  | "no";

export interface BetanoFootballOutcomeDefinition {
  role: BetanoFootballOutcome;
  // Prematch HTML omits outcome type IDs; exact labels remain mandatory.
  typeId?: number;
  label?: string;
}

export interface BetanoFootballMarketDefinition {
  typeId: number;
  type: string;
  nameTemplate: string;
  kind: BetanoFootballMarketKind;
  statistic: BetanoFootballStatistic;
  period: BetanoFootballPeriod;
  subject: BetanoFootballSubject;
  outcomes: readonly [
    BetanoFootballOutcomeDefinition,
    BetanoFootballOutcomeDefinition,
  ];
  condition?: string;
  intervalMinutes?: number;
}
