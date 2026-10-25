import type { AggregationTennisContext } from "./tennis.interfaces.js";

export interface AggregationOutboxHandlers {
  // Re-emit every event and line from the provider projection after attach or reset.
  onResync?(): void;
  onError?(error: string): void;
}

export interface AggregationOutboxEvent {
  handle: number;
  lines: Map<number, number>;
  // Last emitted live state; -1 means none was sent.
  liveFlags: number;
  homeScore: number;
  awayScore: number;
  clockSeconds: number;
  tennis?: AggregationTennisContext;
}

export interface AggregationOutboxStats {
  attached: boolean;
  events: number;
  lines: number;
  batches: number;
  values: number;
  coalescedValues: number;
  resets: number;
  rejected: number;
  inFlight: boolean;
}
