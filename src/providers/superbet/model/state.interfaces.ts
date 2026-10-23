export interface SuperbetRecord {
  [key: string]: unknown;
}

export interface SuperbetFixture extends SuperbetRecord {
  sport_id: number;
  event_name: string;
  offer_state_status?: Record<string, number>;
}

export interface SuperbetOdd extends SuperbetRecord {
  uuid: string;
  price?: number;
  status?: number;
  display?: boolean;
  metadata?: SuperbetRecord;
}

export interface SuperbetMarket extends SuperbetRecord {
  id: number;
  name: string;
  odds: SuperbetOdd[];
  metadata?: SuperbetRecord;
}

export interface SuperbetUpdate extends SuperbetRecord {
  event_id: number;
  increment_id: number;
  fixture?: SuperbetFixture;
  inplay_stats?: SuperbetRecord;
  inplay_stats_metadata?: SuperbetRecord;
  markets?: SuperbetMarket[];
  superbets?: SuperbetMarket[];
  priceboosts?: SuperbetMarket[];
  is_full_market_update?: boolean;
  is_full_superbets_update?: boolean;
  is_full_priceboosts_update?: boolean;
}

export interface SuperbetEvent {
  id: number;
  sportId: number;
  name: string;
  version: number;
}

// Preserve vendor prices and suspension fields without inventing normalized odds.
export interface SuperbetSnapshot extends SuperbetUpdate {
  fixture: SuperbetFixture;
  markets: SuperbetMarket[];
  superbets: SuperbetMarket[];
  priceboosts: SuperbetMarket[];
}

export interface SuperbetEventState {
  event: SuperbetEvent;
  minimumVersion: number;
  snapshot: SuperbetSnapshot | null;
  stale: boolean;
  pending: Map<number, SuperbetUpdate>;
}

export interface SuperbetStoreHandlers {
  onSnapshot(snapshot: SuperbetSnapshot): void;
  onUpdate(update: SuperbetUpdate): void;
  onStale(eventId: number, reason: string): void;
  onRemove(eventId: number): void;
}
