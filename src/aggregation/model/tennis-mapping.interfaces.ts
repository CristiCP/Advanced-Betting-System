import type { AggregationMarketMapping } from "./mapping.interfaces.js";

export interface TennisMarketMapping extends AggregationMarketMapping {
  // Betano's first-set-only types may match only Superbet set 1.
  setNumber?: 1;
}
