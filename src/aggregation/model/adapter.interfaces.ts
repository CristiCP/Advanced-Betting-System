import type { AggregationMarketMapping } from "./mapping.interfaces.js";
import type {
  AggregationEventIdentity,
  AggregationEventLive,
  AggregationProvider,
} from "./wire.interfaces.js";

export interface ProjectionSnapshotLike<
  E extends { id: number },
  L extends { key: string },
> {
  event: E;
  lines: readonly L[];
  // Only explicit false blocks retained prices; standalone prematch views may omit this.
  synchronized?: boolean;
}

export interface ProjectionChangeLike<E, L> {
  kind: "update" | "invalidate" | "remove";
  eventId: number;
  event?: E;
  upserts: readonly L[];
  removed: readonly string[];
}

// Reused for every line so the hot path writes into one object instead of allocating.
export interface ProjectionQuote {
  priceA: number;
  priceB: number;
  usableA: boolean;
  usableB: boolean;
}

// The provider-specific translation from a filtered sport projection to canonical aggregation values.
export interface ProjectionCodec<E, L> {
  provider: AggregationProvider;
  identity(event: E): AggregationEventIdentity | null;
  live(event: E): AggregationEventLive;
  marketType(line: L): number;
  lineKey(line: L, row: AggregationMarketMapping): number | null;
  quote(line: L, quote: ProjectionQuote): void;
}

export interface ProjectionAdapterEvent {
  identity: AggregationEventIdentity;
  // Vendor line key -> canonical key, and the reverse owner of each canonical key.
  lines: Map<string, number>;
  owners: Map<number, string>;
  // Canonical keys claimed by two vendor lines; neither is used until the next baseline.
  ambiguous: Set<number>;
}

export interface ProjectionAdapterStats {
  events: number;
  lines: number;
  rejectedEvents: number;
  ambiguousLines: number;
}

// Preserve existing type imports while both sports use the same projection adapter.
export type FootballCodec<E, L> = ProjectionCodec<E, L>;
export type FootballSnapshotLike<
  E extends { id: number },
  L extends { key: string },
> = ProjectionSnapshotLike<E, L>;
export type FootballChangeLike<E, L> = ProjectionChangeLike<E, L>;
export type FootballQuote = ProjectionQuote;
export type FootballAdapterEvent = ProjectionAdapterEvent;
export type FootballAdapterStats = ProjectionAdapterStats;
