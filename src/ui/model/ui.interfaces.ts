import type { AggregationMatchedEvent } from "../../aggregation/model/matching.interfaces.js";
import type { AggregationOpportunityReport } from "../../aggregation/model/opportunity.interfaces.js";
import type { AggregationStats } from "../../aggregation/model/worker.interfaces.js";
import type { BetanoFootballSnapshot } from "../../providers/betano/model/football-projection.interfaces.js";
import type { BetanoTennisSnapshot } from "../../providers/betano/model/tennis-projection.interfaces.js";
import type { SuperbetFootballSnapshot } from "../../providers/superbet/model/football-projection.interfaces.js";
import type { SuperbetTennisSnapshot } from "../../providers/superbet/model/tennis-projection.interfaces.js";

export type UiProvider = "superbet" | "betano";
export type UiSport = "football" | "basketball" | "tennis";
export type UiProjection =
  | BetanoFootballSnapshot
  | BetanoTennisSnapshot
  | SuperbetFootballSnapshot
  | SuperbetTennisSnapshot;

export interface UiOptions {
  enabled: boolean;
  port: number;
  summaryIntervalMs: number;
  quoteIntervalMs: number;
  historyLimit: number;
  maxLines: number;
  maxEvents: number;
  maxFrameBytes: number;
}

export interface UiEvent {
  provider: UiProvider;
  sport: UiSport;
  id: number;
  name: string;
}

export interface UiSelection {
  sport: "football" | "tennis";
  superbet?: number;
  betano?: number;
}

export interface UiWatchCommand {
  type: "ui-watch";
  generation: number;
  sport: "football" | "tennis";
  eventId: number | null;
}

export interface UiQuoteMessage {
  type: "ui-quotes";
  provider: UiProvider;
  generation: number;
  sport: "football" | "tennis";
  eventId: number;
  at: number;
  snapshot: UiProjection | null;
  truncated: boolean;
}

export interface UiSummary {
  events: Record<UiProvider, UiEvent[]>;
  counts: Record<UiProvider, Record<UiSport, number>>;
  matches: AggregationMatchedEvent[];
  stats: AggregationStats | null;
  at: number;
  truncated: boolean;
}

export interface UiOpportunity {
  sport: "football" | "tennis";
  kind: AggregationOpportunityReport["kind"];
  id: number;
  at: number;
  match: string;
  score: string;
  concept: string;
  line: number;
  legs: { provider: UiProvider; label: string; price: number }[];
  marginBps: number;
  durationMs: number;
  reason?: string;
  reasonDetail?: string;
}

export interface UiFrame {
  type: "frame";
  sequence: number;
  generation: number;
  selection: UiSelection | null;
  summary?: UiSummary;
  quotes?: UiQuoteMessage[];
  opportunities: UiOpportunity[];
  dropped: number;
}

export interface UiChildMessage {
  type: "ready" | "ack" | "watch" | "viewers" | "error";
  sequence?: number;
  selection?: UiSelection | null;
  connected?: boolean;
  url?: string;
  error?: string;
}

export interface UiProviderApi {
  watchUi(command: UiWatchCommand): void;
}

export interface UiQuoteRow {
  key: string;
  provider: UiProvider;
  market: string;
  marketId: number;
  line: string;
  selections: { label: string; price: number | null; available: boolean }[];
  canonicalKey: number | null;
  concept: string | null;
}

export interface UiCanonicalLine {
  key: number;
  concept: string;
}

export interface UiPairedQuoteRow {
  key: string;
  market: string;
  line: string;
  superbet: UiQuoteRow;
  betano: UiQuoteRow;
}

export interface UiQuoteView {
  provider: UiProvider;
  eventId: number;
  at: number;
  synchronized: boolean;
  truncated: boolean;
  rows: UiQuoteRow[];
  name?: string;
  projectedAt?: number;
  sourceVersion?: number | null;
  suspended?: boolean;
  score?: string;
}

export interface UiBrowserUpdate {
  type: "snapshot" | "update";
  clientId?: string;
  summary?: UiSummary | null;
  selection: UiSelection | null;
  quotes?: Partial<Record<UiProvider, UiQuoteView>>;
  resetQuotes?: boolean;
  history?: UiOpportunity[];
  opportunities?: UiOpportunity[];
  dropped: number;
  sequence: number;
}
