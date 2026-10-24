import type { SuperbetOptions } from "./config.interfaces.js";
import type {
  SuperbetFootballChange,
  SuperbetFootballSnapshot,
} from "./football-projection.interfaces.js";
import type { SuperbetSseDecoder } from "../protocol/sse.js";
import type {
  SuperbetEvent,
  SuperbetSnapshot,
  SuperbetUpdate,
} from "./state.interfaces.js";

export interface SuperbetStats {
  events: number;
  synchronizedEvents: number;
  subscriptions: number;
  connectedSubscriptions: number;
  streamOpens: number;
  reconnects: number;
  streamErrors: number;
  decodedBatches: number;
  appliedUpdates: number;
  snapshots: number;
  snapshotRepairs: number;
  snapshotErrors: number;
  decodeErrors: number;
}

export interface SuperbetStatus {
  kind: "connected" | "disconnected" | "event-stale" | "stats";
  eventId?: number;
  reason?: string;
  stats?: SuperbetStats;
}

export interface SuperbetFeedHandlers {
  onEvents(events: SuperbetEvent[]): void;
  onSnapshot(snapshot: SuperbetSnapshot): void;
  onUpdate(update: SuperbetUpdate): void;
  onFootballSnapshot?(snapshot: SuperbetFootballSnapshot): void;
  onFootballUpdate?(change: SuperbetFootballChange): void;
  onRemove(eventId: number): void;
  onStatus(status: SuperbetStatus): void;
  onError(error: string, eventId?: number): void;
}

export interface SuperbetSubscriptionState {
  id: string;
  eventId: number;
  generation: number;
  attempt: number;
  revision: number;
  epoch: number;
  accepting: boolean;
  connected: boolean;
  opens: number;
  lastActivity: number;
  queue: Promise<void>;
  decoder: SuperbetSseDecoder | null;
  synchronizationTimer: ReturnType<typeof setTimeout> | null;
  restarting: Promise<void> | null;
}

export interface SuperbetFeedConfiguration {
  options: SuperbetOptions;
  publishSnapshots: boolean;
  publishUpdates: boolean;
  publishFootballSnapshots: boolean;
  publishFootballUpdates: boolean;
}
