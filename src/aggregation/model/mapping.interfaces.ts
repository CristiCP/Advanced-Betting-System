// D direct, P statistic rules, A Asian total, H Asian handicap, I interval, T yes/no at a fixed threshold.
export type AggregationMappingCondition = "D" | "P" | "A" | "H" | "I" | "T";

export interface AggregationMarketMapping {
  code: number;
  betano: number;
  superbet: number;
  conditions: readonly AggregationMappingCondition[];
  // Required with T: the Superbet total that a Betano yes/no market equals.
  threshold?: number;
  concept: string;
}

// The catalog fields both providers share; enough to verify that a mapping row is coherent.
export interface AggregationCatalogDefinition {
  kind: string;
  statistic: string;
  period: string;
  subject: string;
  outcomes: readonly [{ role: string }, { role: string }];
  intervalMinutes?: number;
  parameters?: readonly string[];
}
