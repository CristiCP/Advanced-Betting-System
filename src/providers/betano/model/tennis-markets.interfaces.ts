export type BetanoTennisOutcome =
  "over" | "under" | "player1" | "player2" | "yes" | "no";

export interface BetanoTennisOutcomeDefinition {
  role: BetanoTennisOutcome;
  // Prematch SSR omits these IDs; configure only values observed in the live API.
  typeId?: number;
}

export interface BetanoTennisMarketDefinition {
  typeId: number;
  type: string;
  nameTemplate: string;
  kind: "total" | "handicap" | "yes-no";
  statistic:
    | "games"
    | "sets"
    | "aces"
    | "double-faults"
    | "tiebreaks"
    | "bagel-sets"
    | "breaks";
  period: "match" | "set";
  subject: "total" | "player1" | "player2" | "both";
  // A fixed first set or an explicitly captured <SET> in the verified market name.
  setNumber?: number;
  condition?: "wins-one-set" | "wins-two-sets" | "both-win-a-set" | "bagel-set";
  outcomes: readonly [
    BetanoTennisOutcomeDefinition,
    BetanoTennisOutcomeDefinition,
  ];
}
