import { aggregationConfig } from "../../aggregation/config.js";
import { mappingIndex } from "../../aggregation/mapping.js";
import { footballMarketMapping } from "../../aggregation/mapping.config.js";
import { tennisMarketMapping } from "../../aggregation/tennis-mapping.config.js";
import type { ProjectionCodec } from "../../aggregation/model/adapter.interfaces.js";
import type { AggregationMarketMapping } from "../../aggregation/model/mapping.interfaces.js";
import { betanoFootballCodec } from "../../providers/betano/processing/aggregation.js";
import { superbetFootballCodec } from "../../providers/superbet/processing/aggregation.js";
import { betanoTennisCodec } from "../../providers/betano/processing/tennis-aggregation.js";
import { superbetTennisCodec } from "../../providers/superbet/processing/tennis-aggregation.js";
import type { BetanoFootballLine } from "../../providers/betano/model/football-projection.interfaces.js";
import type { SuperbetFootballLine } from "../../providers/superbet/model/football-projection.interfaces.js";
import type { BetanoTennisLine } from "../../providers/betano/model/tennis-projection.interfaces.js";
import type { SuperbetTennisLine } from "../../providers/superbet/model/tennis-projection.interfaces.js";
import type {
  UiCanonicalLine,
  UiQuoteMessage,
} from "../model/ui.interfaces.js";

/** @file Reuses aggregation codecs to identify equivalent lines without comparing display names. */

const indexes = {
  football: {
    superbet: mappingIndex(
      "superbet",
      aggregationConfig.enabledConditions,
      footballMarketMapping,
    ),
    betano: mappingIndex(
      "betano",
      aggregationConfig.enabledConditions,
      footballMarketMapping,
    ),
  },
  tennis: {
    superbet: mappingIndex(
      "superbet",
      aggregationConfig.enabledConditions,
      tennisMarketMapping,
    ),
    betano: mappingIndex(
      "betano",
      aggregationConfig.enabledConditions,
      tennisMarketMapping,
    ),
  },
};

function identify<L extends { key: string }>(
  lines: readonly L[],
  codec: Pick<ProjectionCodec<never, L>, "marketType" | "lineKey">,
  index: Map<number, AggregationMarketMapping[]>,
): Map<string, UiCanonicalLine> {
  const result = new Map<string, UiCanonicalLine>();
  const owners = new Map<number, string>();
  const ambiguous = new Set<number>();
  for (const line of lines) {
    for (const row of index.get(codec.marketType(line)) ?? []) {
      const key = codec.lineKey(line, row);
      if (key === null) continue;
      if (ambiguous.has(key)) break;
      const owner = owners.get(key);
      if (owner !== undefined && owner !== line.key) {
        result.delete(owner);
        ambiguous.add(key);
      } else {
        owners.set(key, line.key);
        result.set(line.key, { key, concept: row.concept });
      }
      break;
    }
  }
  return result;
}

export function canonicalLines(
  message: UiQuoteMessage,
): Map<string, UiCanonicalLine> {
  if (message.snapshot === null || message.truncated) return new Map();
  const lines = message.snapshot.lines;
  const index = indexes[message.sport][message.provider];
  if (message.sport === "football")
    return message.provider === "superbet"
      ? identify(lines as SuperbetFootballLine[], superbetFootballCodec, index)
      : identify(lines as BetanoFootballLine[], betanoFootballCodec, index);
  return message.provider === "superbet"
    ? identify(lines as SuperbetTennisLine[], superbetTennisCodec, index)
    : identify(lines as BetanoTennisLine[], betanoTennisCodec, index);
}
