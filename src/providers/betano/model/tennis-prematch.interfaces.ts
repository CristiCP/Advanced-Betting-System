export interface BetanoPrematchTennisParticipant {
  id: string;
  name: string;
}

export interface BetanoPrematchTennisSelection {
  id: string;
  name: string;
  fullName?: string;
  price?: number;
  handicap?: number;
  isSuspended?: boolean;
}

export interface BetanoPrematchTennisMarket {
  id: string;
  type: string;
  typeId: number;
  name: string;
  handicap?: number;
  isSuspended?: boolean;
  selections: BetanoPrematchTennisSelection[];
}

export interface BetanoPrematchTennisEvent {
  id: string;
  sportId: string;
  name: string;
  participants: BetanoPrematchTennisParticipant[];
  startTime?: number;
  leagueId?: string;
  regionId?: string;
  betRadarId?: number;
  isTennisDoubles?: boolean;
  markets: BetanoPrematchTennisMarket[];
}
