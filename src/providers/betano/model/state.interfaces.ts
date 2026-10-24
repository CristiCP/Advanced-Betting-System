export type BetanoSport = "FOOT" | "BASK" | "TENN";

// Keep vendor fields available without introducing untyped application values.
export interface BetanoRecord {
  [key: string]: unknown;
}

export interface BetanoParticipant extends BetanoRecord {
  name: string;
  isHome?: boolean;
  teamId?: number;
}

export interface BetanoEvent extends BetanoRecord {
  id: number;
  sportId: BetanoSport;
  isLive?: boolean;
  isEnded?: boolean;
  isSuspended?: boolean;
  participants?: BetanoParticipant[];
  startTime?: number;
  leagueId?: number;
  zoneId?: number;
  marketIdList: number[];
}

export interface BetanoMarket extends BetanoRecord {
  id: number;
  typeId?: number;
  type?: string;
  name?: string;
  handicap?: number;
  selectionIdList: number[];
  isSuspended?: boolean;
}

export interface BetanoSelection extends BetanoRecord {
  id: number;
  typeId?: number;
  name?: string;
  fullName?: string;
  handicap?: number;
  teamId?: number;
  price?: number;
  isSuspended?: boolean;
}

export interface BetanoSnapshot extends BetanoRecord {
  version: number;
  event: BetanoEvent;
  markets: Record<string, BetanoMarket>;
  selections: Record<string, BetanoSelection>;
}

export interface BetanoDiff {
  eventId: number;
  version: number;
  sportId?: number;
  type: number;
  payload: BetanoRecord;
}

export interface BetanoEventState {
  event: BetanoEvent;
  snapshot: BetanoSnapshot | null;
  stale: boolean;
  pending: Map<number, BetanoDiff>;
  targetVersion: number;
  loading: boolean;
}

export interface BetanoStoreHandlers {
  onSnapshot(snapshot: BetanoSnapshot): void;
  onUpdate(diff: BetanoDiff): void;
  onStale(eventId: number, reason: string): void;
  onRemove(eventId: number): void;
}
