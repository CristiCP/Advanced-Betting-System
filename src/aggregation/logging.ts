import { styleText } from "node:util";
import type { AggregationHandlers } from "./model/controller.interfaces.js";
import type { AggregationCloseReason } from "./model/opportunity.interfaces.js";

/**
 * @file Prints minute summaries of comparable matches, colored opportunities, and aggregation errors.
 */

const colors = {
  open: "green",
  update: "blue",
  pause: "yellow",
  resume: "blue",
  close: "red",
} as const;
const labels = {
  open: "FOUND",
  update: "UPDATE",
  pause: "PAUSED",
  resume: "RESUMED",
  close: "CLOSED",
} as const;
const reasons: Record<AggregationCloseReason, string> = {
  stale: "date neconfirmate, resincronizare în curs",
  pair: "pereche neconfirmată",
  "not-live": "meci ieșit din live",
  suspended: "meci suspendat",
  score: "scoruri diferite sau lipsă",
  "tennis-context": "context tenis diferit, lipsă sau set încheiat",
  settling: "pauză după schimbarea scorului",
  lag: "batch întârziat",
  margin: "marjă sub prag sau selecție indisponibilă",
  unlinked: "linie retrasă sau pereche pierdută",
  stopped: "oprirea aplicației",
};
const matchSummaryIntervalMs = 60_000;
const initialSummaryWaitMs = 30_000;
// Only margin closures above 0.5% are purple; other closing reasons stay red.
const closeMarginColorBps = 50;
// Wait for usable pairs at startup, with a deadline when none become available.
let initialSummaryDeadline: number | null = null;
let nextMatchSummaryAt = 0;

export const aggregationConsoleHandlers: AggregationHandlers = {
  onStatus({ stats }) {
    const now = Date.now();
    const football = stats.sports?.football?.activeMatches ?? stats.activeMatches;
    const tennis = stats.sports?.tennis?.activeMatches ?? 0;
    if (nextMatchSummaryAt === 0) {
      if (initialSummaryDeadline === null) {
        initialSummaryDeadline = now + initialSummaryWaitMs;
        if (football + tennis === 0)
          console.log(
            "[MATCHED ACTIVE] Superbet <-> Betano | initializare: astept primele perechi utilizabile...",
          );
      }
      if (football + tennis === 0 && now < initialSummaryDeadline) return;
    }
    if (now < nextMatchSummaryAt) return;
    nextMatchSummaryAt = now + matchSummaryIntervalMs;
    console.log(
      `[MATCHED ACTIVE] Superbet <-> Betano | total=${football + tennis} | football=${football} | tennis=${tennis}`,
    );
  },
  onOpportunity(report) {
    const legs = report.legs
      .map((leg) => `${leg.provider} ${leg.label} @ ${leg.price}`)
      .join(" <> ");
    const margin = `${report.marginBps >= 0 ? "+" : ""}${(report.marginBps / 100).toFixed(2)}%`;
    const closing =
      report.kind === "close"
        ? ` | durata=${(report.durationMs / 1_000).toFixed(3)}s | motiv=${report.reason ? `${report.reason}: ${report.reasonDetail ?? reasons[report.reason]}` : "necunoscut"}`
        : "";
    const suspicious = report.suspicious ? " | SUSPICIOUS" : "";
    const availability =
      report.kind === "pause"
        ? ` | ultimele cote confirmate; ${report.reasonDetail ?? reasons.stale}`
        : report.unconfirmedMs > 0
          ? ` | timp neconfirmat=${(report.unconfirmedMs / 1_000).toFixed(3)}s`
          : "";
    const time = new Date(report.at).toISOString().slice(11, 23);
    // Keep vendor names on one line; styleText respects terminal color support and NO_COLOR.
    const line =
      `[${time}Z ${labels[report.kind]} #${report.id}]${report.sport === "tennis" ? " [TENNIS]" : ""} ${report.match} (${report.score}) | ${report.concept} | linie=${report.line} | ${legs} | marja=${margin}${closing}${availability}${suspicious}`
        .replace(/\s+/g, " ")
        .trim();
    const color =
      report.kind === "close" &&
      report.reason === "margin" &&
      report.marginBps > closeMarginColorBps
        ? "magenta"
        : colors[report.kind];
    console.log(styleText(color, line));
  },
  onError(error, provider) {
    console.error("Aggregation:", { provider, error });
  },
};
