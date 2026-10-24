import type {
  AggregationEventIdentity,
  AggregationProvider,
} from "./wire.interfaces.js";

export interface NormalizedTeam {
  // Significant tokens after removing accents, punctuation, legal forms, and markers.
  tokens: string[];
  key: string;
  // Sorted squad markers (u21, w, ii, ldd, academy...); different markers mean different teams.
  markers: string;
}

export interface AggregationEvent {
  provider: AggregationProvider;
  handle: number;
  identity: AggregationEventIdentity;
  home: NormalizedTeam;
  away: NormalizedTeam;
  live: boolean;
  suspended: boolean;
  scoreKnown: boolean;
  homeScore: number;
  awayScore: number;
  clockKnown: boolean;
  clockRunning: boolean;
  clockSeconds: number;
  // Wall-clock time when the clock value or its running state last changed.
  clockAt: number;
  // Wall-clock time of the last score change seen by the aggregator; NaN before any score.
  scoreChangedAt: number;
  // Canonical line key -> line handle in this provider's quote book.
  lines: Map<number, number>;
  pair: AggregationPair | null;
  conflict: boolean;
}

export type AggregationPairState = "confirmed" | "suspect";

export type AggregationPairReason =
  | "start"
  | "markers"
  | "orientation"
  | "clock"
  | "score"
  | "unverified";

export interface AggregationPair {
  id: number;
  betradarId: number;
  superbet: AggregationEvent;
  betano: AggregationEvent;
  state: AggregationPairState;
  reasons: AggregationPairReason[];
  // Name evidence in the provider orientation, 0..1 per side.
  similarity: number;
  createdAt: number;
  // NaN while both scores agree.
  scoreMismatchSince: number;
  // Superbet line handles currently linked to a Betano line of this pair.
  links: Set<number>;
  // Time after which a recent score change no longer blocks comparison.
  settleUntil: number;
}

export interface AggregationPairReport {
  kind: "pair";
  at: number;
  betradarId: number;
  superbetEventId: number;
  betanoEventId: number;
  match: string;
  betanoMatch: string;
  state: AggregationPairState | "removed";
  reasons: AggregationPairReason[];
  similarity: number;
}

export interface AggregationObservedPair {
  kind: "observed";
  at: number;
  superbetEventId: number;
  betanoEventId: number;
  superbet: string;
  betano: string;
  startDifferenceMs: number;
  similarity: number;
}

export interface AggregationMatchingSummary {
  confirmed: number;
  suspect: number;
  conflicts: number;
  unmatched: Record<AggregationProvider, { withId: number; withoutId: number }>;
  observed: number;
  reasons: Partial<Record<AggregationPairReason, number>>;
  aliases: number;
  competitions: number;
}

export interface AggregationLearnedTables {
  version: 1;
  aliases: [string, string][];
  competitions: [number, number][];
}
