export type AggregationSport = "football" | "tennis";

export interface TennisScoringEvent {
  player1: { name: string };
  player2: { name: string };
  player1Points: string | null;
  player2Points: string | null;
  serving: "player1" | "player2" | null;
  sets: readonly TennisScoringSet[];
  currentSetNumber?: number | null;
  isDoubles?: boolean | null;
}

export interface TennisScoringSet {
  number: number;
  player1Games: number | null;
  player2Games: number | null;
}

export interface AggregationTennisContext {
  // Set numbers are positional and contiguous; null means an unknown score.
  sets: readonly (readonly [number | null, number | null])[];
  // Advantage is 65534; null stays unknown and never becomes zero.
  points: readonly [number | null, number | null];
  server: 0 | 1 | 2;
  // 0 unknown, 1 singles, 2 doubles; used conservatively for set restrictions.
  doubles: 0 | 1 | 2;
  currentSet: number | null;
}
