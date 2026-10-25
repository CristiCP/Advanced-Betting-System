import type { BetanoTennisOutcome } from "./tennis-markets.interfaces.js";

export interface BetanoTennisPlayer {
  id: string | null;
  name: string;
  // Doubles participants can contain two vendor player IDs, in their supplied order.
  playerIds: readonly number[];
}

export interface BetanoTennisSetScore {
  number: number;
  player1Games: number | null;
  player2Games: number | null;
}

export interface BetanoTennisEvent {
  id: number;
  betradarId: number | null;
  player1: BetanoTennisPlayer;
  player2: BetanoTennisPlayer;
  competitionId: number | null;
  categoryId: number | null;
  startsAt: string | null;
  phase: "prematch" | "live";
  isSuspended: boolean;
  isDoubles: boolean | null;
  player1Sets: number | null;
  player2Sets: number | null;
  player1Points: string | null;
  player2Points: string | null;
  serving: "player1" | "player2" | null;
  currentSetNumber: number | null;
  // Relative to the current set, unlike Betano's match-wide currentTennisGame.
  currentGameNumber: number | null;
  sets: readonly BetanoTennisSetScore[];
}

export interface BetanoTennisSelection {
  id: string;
  outcomeId: number | null;
  role: BetanoTennisOutcome;
  price: number | null;
  isSuspended: boolean;
  handicap: number | null;
}

export interface BetanoTennisLine {
  key: string;
  marketId: number;
  marketTypeId: number;
  total: number | null;
  // Oriented to player1; each selection retains its own signed value.
  handicap: number | null;
  setNumber: number | null;
  gameNumber: number | null;
  isSuspended: boolean;
  selections: readonly [BetanoTennisSelection, BetanoTennisSelection];
}

export interface BetanoTennisSnapshot {
  provider: "betano";
  event: BetanoTennisEvent;
  // Standalone prematch SSR has no vendor version.
  sourceVersion: number | null;
  projectedAt: number;
  synchronized: boolean;
  lines: BetanoTennisLine[];
}

export interface BetanoTennisChange {
  kind: "update" | "invalidate" | "remove";
  eventId: number;
  sourceVersion: number;
  projectedAt: number;
  event?: BetanoTennisEvent;
  upserts: BetanoTennisLine[];
  removed: string[];
}

export interface BetanoTennisProjectionState {
  synchronized: boolean;
  event: BetanoTennisEvent;
  sourceVersion: number;
  projectedAt: number;
  groups: Map<number, Map<string, BetanoTennisLine>>;
  activeMarkets: Set<number>;
  selectionMarkets: Map<number, number>;
  marketSelections: Map<number, number[]>;
}

export interface BetanoTennisProjectionHandlers {
  onSnapshot?(snapshot: BetanoTennisSnapshot): void;
  onUpdate?(change: BetanoTennisChange): void;
}
