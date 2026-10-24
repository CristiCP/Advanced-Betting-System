import type { SuperbetFootballOutcome } from "./football-markets.interfaces.js";

export interface SuperbetFootballTeam {
  id: string | null;
  name: string;
}

export interface SuperbetFootballEvent {
  id: number;
  home: SuperbetFootballTeam;
  away: SuperbetFootballTeam;
  competitionId: number | null;
  categoryId: number | null;
  startsAt: string | null;
  phase: "prematch" | "live";
  status: string;
  offerStatus: number | null;
  homeScore: string | null;
  awayScore: string | null;
  period: string | null;
  minute: string | null;
  stoppageTime: string | null;
}

export interface SuperbetFootballSelection {
  id: string;
  outcomeId: number;
  role: SuperbetFootballOutcome;
  price: number | null;
  status: number | null;
  display: boolean;
  // Handicap is signed for this selection; the line's handicap is home-oriented.
  handicap: number | null;
}

export interface SuperbetFootballLine {
  key: string;
  marketId: number;
  lineId: string;
  offerStateId: 1 | 2;
  total: number | null;
  handicap: number | null;
  fromMinute: number | null;
  toMinute: number | null;
  firstMinutes: number | null;
  selections: readonly [SuperbetFootballSelection, SuperbetFootballSelection];
}

export interface SuperbetFootballSnapshot {
  provider: "superbet";
  event: SuperbetFootballEvent;
  sourceVersion: number;
  projectedAt: number;
  lines: SuperbetFootballLine[];
}

export interface SuperbetFootballChange {
  kind: "update" | "invalidate";
  eventId: number;
  sourceVersion: number;
  projectedAt: number;
  event?: SuperbetFootballEvent;
  upserts: SuperbetFootballLine[];
  removed: string[];
}

export interface SuperbetFootballProjectionState {
  event: SuperbetFootballEvent;
  sourceVersion: number;
  projectedAt: number;
  // Each vendor market group owns its projected lines independently.
  groups: Map<string, Map<string, SuperbetFootballLine>>;
}

export interface SuperbetFootballProjectionHandlers {
  onSnapshot?(snapshot: SuperbetFootballSnapshot): void;
  onUpdate?(change: SuperbetFootballChange): void;
}
