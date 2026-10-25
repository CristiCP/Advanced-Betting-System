import type { SuperbetTennisOutcome } from "./tennis-markets.interfaces.js";

export interface SuperbetTennisPlayer {
  // The vendor may identify a doubles pair as one participant.
  id: string | null;
  name: string;
}

export interface SuperbetTennisSetScore {
  number: number;
  player1Games: number | null;
  player2Games: number | null;
  // Preserve the vendor type without guessing the scoring format.
  sourceType: number | null;
}

export interface SuperbetTennisEvent {
  id: number;
  betradarId: number | null;
  player1: SuperbetTennisPlayer;
  player2: SuperbetTennisPlayer;
  competitionId: number | null;
  categoryId: number | null;
  startsAt: string | null;
  phase: "prematch" | "live";
  status: string;
  offerStatus: number | null;
  player1Sets: number | null;
  player2Sets: number | null;
  // Raw point notation also covers advantage and tiebreak points.
  player1Points: string | null;
  player2Points: string | null;
  serving: "player1" | "player2" | null;
  sets: readonly SuperbetTennisSetScore[];
}

export interface SuperbetTennisSelection {
  id: string;
  outcomeId: number;
  role: SuperbetTennisOutcome;
  price: number | null;
  status: number | null;
  display: boolean;
  handicap: number | null;
}

export interface SuperbetTennisLine {
  key: string;
  marketId: number;
  lineId: string;
  offerStateId: 1 | 2;
  total: number | null;
  // Oriented to player1; player2's selection carries the opposite sign.
  handicap: number | null;
  setNumber: number | null;
  gameNumber: number | null;
  selections: readonly [SuperbetTennisSelection, SuperbetTennisSelection];
}

export interface SuperbetTennisSnapshot {
  provider: "superbet";
  event: SuperbetTennisEvent;
  sourceVersion: number;
  projectedAt: number;
  synchronized: boolean;
  lines: SuperbetTennisLine[];
}

export interface SuperbetTennisChange {
  kind: "update" | "invalidate" | "remove";
  eventId: number;
  sourceVersion: number;
  projectedAt: number;
  event?: SuperbetTennisEvent;
  upserts: SuperbetTennisLine[];
  removed: string[];
}

export interface SuperbetTennisProjectionState {
  synchronized: boolean;
  event: SuperbetTennisEvent;
  sourceVersion: number;
  projectedAt: number;
  groups: Map<string, Map<string, SuperbetTennisLine>>;
}

export interface SuperbetTennisProjectionHandlers {
  onSnapshot?(snapshot: SuperbetTennisSnapshot): void;
  onUpdate?(change: SuperbetTennisChange): void;
}
