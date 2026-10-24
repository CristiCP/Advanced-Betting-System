export interface BetanoPrematchParticipant {
  id: string;
  name: string;
}

export interface BetanoPrematchSelection {
  id: string;
  name: string;
  fullName?: string;
  price?: number;
  handicap?: number;
  teamId?: string;
  isSuspended?: boolean;
}

export interface BetanoPrematchMarket {
  id: string;
  type: string;
  typeId: number;
  name: string;
  handicap?: number;
  isSuspended?: boolean;
  selections: BetanoPrematchSelection[];
}

export interface BetanoPrematchFootballEvent {
  id: string;
  sportId: string;
  name: string;
  participants: BetanoPrematchParticipant[];
  startTime?: number;
  leagueId?: string;
  regionId?: string;
  markets: BetanoPrematchMarket[];
}
