export type SuperbetTennisMarketKind = "total" | "handicap" | "yes-no";
export type SuperbetTennisStatistic =
  | "games"
  | "sets"
  | "points-won"
  | "points-served"
  | "points-played"
  | "aces"
  | "double-faults"
  | "tiebreaks"
  | "tiebreak-or-match-tiebreak"
  | "bagel-sets"
  | "deuce";
export type SuperbetTennisPeriod = "match" | "set" | "game" | "deciding-set";
export type SuperbetTennisSubject = "total" | "player1" | "player2";
export type SuperbetTennisOutcome =
  "under" | "over" | "player1" | "player2" | "yes" | "no";
export type SuperbetTennisParameter = "total" | "hcp" | "setnr" | "gamenr";

export interface SuperbetTennisOutcomeDefinition {
  id: number;
  role: SuperbetTennisOutcome;
  nameTemplate: string;
}

export interface SuperbetTennisMarketDefinition {
  id: number;
  nameTemplate: string;
  kind: SuperbetTennisMarketKind;
  statistic: SuperbetTennisStatistic;
  period: SuperbetTennisPeriod;
  subject: SuperbetTennisSubject;
  parameters: readonly SuperbetTennisParameter[];
  outcomes: readonly [
    SuperbetTennisOutcomeDefinition,
    SuperbetTennisOutcomeDefinition,
  ];
}
