import type {
  SuperbetUpdate,
  SuperbetEvent,
  SuperbetSnapshot,
} from "./state.interfaces.js";
import type { SuperbetStats, SuperbetStatus } from "./feed.interfaces.js";

export interface SuperbetHandlers {
  onEvents?(events: SuperbetEvent[]): void;
  onSnapshot?(snapshot: SuperbetSnapshot): void;
  onUpdate?(update: SuperbetUpdate): void;
  onRemove?(eventId: number): void;
  onStatus?(status: SuperbetStatus): void;
  onError?(error: string, eventId?: number): void;
}

export interface SuperbetProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  getEvents(): Promise<SuperbetEvent[]>;
  // Return null while an event is missing or its odds are being repaired.
  getSnapshot(eventId: number): Promise<SuperbetSnapshot | null>;
  getStats(): Promise<SuperbetStats>;
  reconnect(): Promise<void>;
}

export interface PendingSuperbetQuery {
  resolve(value: unknown): void;
  reject(error: Error): void;
}
