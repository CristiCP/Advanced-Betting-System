export type SuperbetFootballMarketKind =
  | "total"
  | "asian-total"
  | "handicap"
  | "asian-handicap"
  | "yes-no";

export type SuperbetFootballStatistic =
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
  | "tackles"
  | "penalties"
  | "own-goals"
  | "woodwork";

export type SuperbetFootballPeriod =
  | "match"
  | "first-half"
  | "second-half"
  | "first-minutes"
  | "interval";

export type SuperbetFootballSubject = "total" | "home" | "away" | "both";
export type SuperbetFootballOutcome =
  | "under"
  | "over"
  | "home"
  | "away"
  | "yes"
  | "no";
export type SuperbetFootballParameter = "total" | "hcp" | "from" | "to" | "xnr";

export interface SuperbetFootballOutcomeDefinition {
  id: number;
  role: SuperbetFootballOutcome;
}

export interface SuperbetFootballMarketDefinition {
  id: number;
  nameTemplate: string;
  kind: SuperbetFootballMarketKind;
  statistic: SuperbetFootballStatistic;
  period: SuperbetFootballPeriod;
  subject: SuperbetFootballSubject;
  parameters: readonly SuperbetFootballParameter[];
  outcomes: readonly [
    SuperbetFootballOutcomeDefinition,
    SuperbetFootballOutcomeDefinition,
  ];
  intervalMinutes?: number;
}
