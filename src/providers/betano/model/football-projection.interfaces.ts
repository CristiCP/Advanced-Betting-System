import type { BetanoFootballOutcome } from "./football-markets.interfaces.js";

export interface BetanoFootballTeam {
  id: string | null;
  name: string;
}

export interface BetanoFootballEvent {
  id: number;
  // Shared match ID used to pair events across books; null when absent or malformed.
  betradarId: number | null;
  home: BetanoFootballTeam;
  away: BetanoFootballTeam;
  competitionId: number | null;
  categoryId: number | null;
  startsAt: string | null;
  phase: "prematch" | "live";
  isSuspended: boolean;
  homeScore: string | null;
  awayScore: string | null;
  clockSeconds: number | null;
  clockStopped: boolean | null;
}

export interface BetanoFootballInterval {
  fromSecond: number;
  toSecond: number;
  // A named boundary at 45:00 or 90:00 must not become an ordinary :59 interval.
  endsAtPeriodBoundary: boolean;
}

export interface BetanoFootballScoreContext {
  home: number;
  away: number;
}

export interface BetanoFootballSelection {
  id: string;
  outcomeId: number | null;
  role: BetanoFootballOutcome;
  price: number | null;
  isSuspended: boolean;
  handicap: number | null;
}

export interface BetanoFootballLine {
  key: string;
  marketId: number;
  marketTypeId: number;
  total: number | null;
  // Home-oriented value; each selection also retains its own signed handicap.
  handicap: number | null;
  interval: BetanoFootballInterval | null;
  scoreContext: BetanoFootballScoreContext | null;
  isSuspended: boolean;
  selections: readonly [BetanoFootballSelection, BetanoFootballSelection];
}

export interface BetanoFootballSnapshot {
  provider: "betano";
  event: BetanoFootballEvent;
  // Public prematch HTML has no version; live versions come from the vendor store.
  sourceVersion: number | null;
  projectedAt: number;
  // False retains identity internally while public snapshot queries return null.
  synchronized?: boolean;
  lines: BetanoFootballLine[];
}

export interface BetanoFootballChange {
  kind: "update" | "invalidate" | "remove";
  eventId: number;
  sourceVersion: number;
  projectedAt: number;
  event?: BetanoFootballEvent;
  upserts: BetanoFootballLine[];
  removed: string[];
}

export interface BetanoFootballProjectionState {
  synchronized: boolean;
  event: BetanoFootballEvent;
  sourceVersion: number;
  projectedAt: number;
  groups: Map<number, Map<string, BetanoFootballLine>>;
  activeMarkets: Set<number>;
  selectionMarkets: Map<number, number>;
  marketSelections: Map<number, number[]>;
}

export interface BetanoFootballProjectionHandlers {
  onSnapshot?(snapshot: BetanoFootballSnapshot): void;
  onUpdate?(change: BetanoFootballChange): void;
}
