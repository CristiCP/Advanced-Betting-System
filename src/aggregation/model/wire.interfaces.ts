import type { AggregationMappingCondition } from "./mapping.interfaces.js";
import type { AggregationTennisContext } from "./tennis.interfaces.js";

export type AggregationProvider = "superbet" | "betano";

// Limits are chosen by the aggregator and sent with attach, so both sides validate the same bounds.
export interface AggregationOutboxOptions {
  batchWindowMs: number;
  maxEvents: number;
  maxLines: number;
  maxBatchBytes: number;
  // Mapping rows are sent only when every one of their conditions is enabled.
  enabledConditions: AggregationMappingCondition[];
}

export interface AggregationEventIdentity {
  eventId: number;
  // Zero means the provider did not publish a valid Betradar match ID.
  betradarId: number;
  // NaN means the start time is unknown.
  startsAt: number;
  competitionId: number;
  categoryId: number;
  home: string;
  away: string;
}

export interface AggregationEventLive {
  // Independent of market suspension; false blocks all comparisons for this event.
  synchronized?: boolean;
  live: boolean;
  suspended: boolean;
  // Null scores and clock mean the provider did not publish a valid value.
  homeScore: number | null;
  awayScore: number | null;
  clockSeconds: number | null;
  clockRunning: boolean;
  tennis?: AggregationTennisContext;
}

export interface AggregationBatchHeader {
  provider: AggregationProvider;
  generation: number;
  sequence: number;
  sentAt: number;
  byteLength: number;
  segments: number;
}

// Receives decoded operations in wire order; primitive arguments keep the value path allocation-free.
export interface AggregationBatchSink {
  reset(): void;
  eventIdentity(event: number, identity: AggregationEventIdentity): void;
  eventLive(
    event: number,
    flags: number,
    homeScore: number,
    awayScore: number,
    clockSeconds: number,
  ): void;
  eventRelease(event: number): void;
  eventTennis?(event: number, context: AggregationTennisContext): void;
  lineDefine(line: number, event: number, key: number): void;
  lineRelease(line: number): void;
  value(line: number, priceA: number, priceB: number, flags: number): void;
}

export interface AggregationBatchMessage {
  type: "batch";
  generation: number;
  sequence: number;
  buffer: ArrayBuffer;
}

// Messages sent by the aggregator to a provider outbox.
export type AggregationControlMessage =
  | {
      type: "attach";
      generation: number;
      options: AggregationOutboxOptions;
    }
  | {
      type: "ack";
      generation: number;
      sequence: number;
      buffer: ArrayBuffer;
    }
  | {
      type: "resync";
      generation: number;
      sequence: number;
    };
