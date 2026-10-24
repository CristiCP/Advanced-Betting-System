import type { AggregationMarketMapping } from "./mapping.interfaces.js";
import type {
  AggregationEventIdentity,
  AggregationEventLive,
  AggregationProvider,
} from "./wire.interfaces.js";

export interface FootballSnapshotLike<E extends { id: number }, L extends { key: string }> {
  event: E;
  lines: readonly L[];
}

export interface FootballChangeLike<E, L> {
  kind: "update" | "invalidate";
  eventId: number;
  event?: E;
  upserts: readonly L[];
  removed: readonly string[];
}

// Reused for every line so the hot path writes into one object instead of allocating.
export interface FootballQuote {
  priceA: number;
  priceB: number;
  usableA: boolean;
  usableB: boolean;
}

// The provider-specific translation from its football projection to canonical aggregation values.
export interface FootballCodec<E, L> {
  provider: AggregationProvider;
  identity(event: E): AggregationEventIdentity | null;
  live(event: E): AggregationEventLive;
  marketType(line: L): number;
  lineKey(line: L, row: AggregationMarketMapping): number | null;
  quote(line: L, quote: FootballQuote): void;
}

export interface FootballAdapterEvent {
  identity: AggregationEventIdentity;
  // Vendor line key -> canonical key, and the reverse owner of each canonical key.
  lines: Map<string, number>;
  owners: Map<number, string>;
  // Canonical keys claimed by two vendor lines; neither is used until the next baseline.
  ambiguous: Set<number>;
}

export interface FootballAdapterStats {
  events: number;
  lines: number;
  rejectedEvents: number;
  ambiguousLines: number;
}
