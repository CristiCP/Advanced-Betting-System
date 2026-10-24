import type { BetanoOptions } from "./config.interfaces.js";
import type { SignalRSession } from "../protocol/signalr.js";
import type {
  BetanoFootballChange,
  BetanoFootballSnapshot,
} from "./football-projection.interfaces.js";
import type {
  BetanoDiff,
  BetanoEvent,
  BetanoSnapshot,
} from "./state.interfaces.js";

export interface BetanoStats {
  events: number;
  synchronizedEvents: number;
  sockets: number;
  connectedSockets: number;
  snapshots: number;
  snapshotErrors: number;
  decodedBatches: number;
  appliedDiffs: number;
  resynchronizations: number;
}

export interface BetanoStatus {
  kind: "connected" | "disconnected" | "event-stale" | "stats";
  socketId?: string;
  eventId?: number;
  reason?: string;
  stats?: BetanoStats;
}

export interface BetanoFeedHandlers {
  onEvents(events: BetanoEvent[]): void;
  onSnapshot(snapshot: BetanoSnapshot): void;
  onUpdate(diff: BetanoDiff): void;
  onFootballSnapshot?(snapshot: BetanoFootballSnapshot): void;
  onFootballUpdate?(change: BetanoFootballChange): void;
  onRemove(eventId: number): void;
  onStatus(status: BetanoStatus): void;
  onError(error: string, eventId?: number): void;
}

export interface BetanoSocketState {
  id: string;
  events: Set<number>;
  generation: number;
  attempt: number;
  session: SignalRSession | null;
  restarting: Promise<void> | null;
}

export interface BetanoFeedConfiguration {
  options: BetanoOptions;
  publishSnapshots: boolean;
  publishUpdates: boolean;
  publishFootballSnapshots: boolean;
  publishFootballUpdates: boolean;
}
