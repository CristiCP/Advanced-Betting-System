import type {
  BetanoDiff,
  BetanoEvent,
  BetanoSnapshot,
} from "./state.interfaces.js";
import type { BetanoStats, BetanoStatus } from "./feed.interfaces.js";
import type {
  BetanoFootballChange,
  BetanoFootballSnapshot,
} from "./football-projection.interfaces.js";

export interface BetanoHandlers {
  onEvents?(events: BetanoEvent[]): void;
  onSnapshot?(snapshot: BetanoSnapshot): void;
  onUpdate?(diff: BetanoDiff): void;
  onFootballSnapshot?(snapshot: BetanoFootballSnapshot): void;
  onFootballUpdate?(change: BetanoFootballChange): void;
  onRemove?(eventId: number): void;
  onStatus?(status: BetanoStatus): void;
  onError?(error: string, eventId?: number): void;
}

export interface BetanoProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  getEvents(): Promise<BetanoEvent[]>;
  // Return null while an event is missing or its odds are being repaired.
  getSnapshot(eventId: number): Promise<BetanoSnapshot | null>;
  getFootballSnapshot(eventId: number): Promise<BetanoFootballSnapshot | null>;
  getStats(): Promise<BetanoStats>;
  reconnect(): Promise<void>;
}

export interface PendingBetanoQuery {
  resolve(value: unknown): void;
  reject(error: Error): void;
}
