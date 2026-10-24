import type {
  AggregationObservedPair,
  AggregationPairReport,
} from "./matching.interfaces.js";
import type { AggregationProvider } from "./wire.interfaces.js";

export type AggregationGate =
  | "pair"
  | "not-live"
  | "suspended"
  | "score"
  | "settling"
  | "lag";

export type AggregationCloseReason =
  | AggregationGate
  | "margin"
  | "unlinked"
  | "stopped";

export interface AggregationOpportunityLeg {
  provider: AggregationProvider;
  // A is over/home/yes, B is under/away/no; label gives the market's own wording.
  outcome: "A" | "B";
  label: string;
  price: number;
  // Fraction of the total stake for an equal payout on either outcome.
  stakeShare: number;
  // Time since this price last changed; a fresh leg against an old one often means a book lagging a move.
  ageMs: number;
}

export interface AggregationOpportunityReport {
  kind: "open" | "update" | "close";
  id: number;
  at: number;
  betradarId: number;
  superbetEventId: number;
  betanoEventId: number;
  match: string;
  score: string;
  marketCode: number;
  concept: string;
  line: number;
  legs: [AggregationOpportunityLeg, AggregationOpportunityLeg];
  marginBps: number;
  maxMarginBps: number;
  suspicious: boolean;
  openedAt: number;
  durationMs: number;
  reason?: AggregationCloseReason;
}

export interface AggregationOpportunityState {
  id: number;
  superbetLine: number;
  betanoLine: number;
  openedAt: number;
  // 0: Superbet A with Betano B; 1: Betano A with Superbet B.
  orientation: number;
  priceA: number;
  priceB: number;
  marginBps: number;
  maxMarginBps: number;
  reportedMarginBps: number;
  last: AggregationOpportunityReport;
}

export interface AggregationOpportunityStats {
  open: number;
  opened: number;
  closed: number;
  suspicious: number;
  linkedLines: number;
  // Window values since the previous periodic report: compared lines and the best margin among them.
  compared: number;
  bestMarginBps: number | null;
}

export type AggregationReport =
  | AggregationPairReport
  | AggregationObservedPair
  | (AggregationOpportunityReport & { type: "opportunity" });
