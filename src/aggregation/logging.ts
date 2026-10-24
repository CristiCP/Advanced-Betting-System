import type { AggregationHandlers } from "./model/controller.interfaces.js";

/**
 * @file Reports opportunities, pair changes, name-only candidates, and aggregation statistics.
 */

const percent = (bps: number): string => `${(bps / 100).toFixed(2)}%`;

export const aggregationConsoleHandlers: AggregationHandlers = {
  onOpportunity(report) {
    const legs = report.legs
      .map(
        (leg) =>
          `${leg.provider} ${leg.label} @ ${leg.price} (${Math.round(leg.ageMs / 1_000)}s)`,
      )
      .join(" | ");
    const line = report.line ? ` ${report.line}` : "";
    const tag = report.suspicious ? " SUSPICIOUS" : "";
    if (report.kind === "close")
      console.log(
        `Opportunity #${report.id} closed (${report.reason}) after ${Math.round(report.durationMs / 1_000)}s, max ${percent(report.maxMarginBps)}`,
      );
    else
      console.log(
        `Opportunity #${report.id} ${report.kind}${tag}: ${report.match} [${report.score}] ${report.concept}${line} — ${legs} — ${percent(report.marginBps)}`,
      );
  },
  // Confirmations and removals after provider repairs are routine; only suspicion needs attention.
  onPair(report) {
    if (report.state !== "suspect") return;
    console.log("Aggregation pair:", {
      state: report.state,
      superbet: report.match,
      betano: report.betanoMatch,
      reasons: report.reasons,
      similarity: report.similarity,
    });
  },
  onObserved(report) {
    console.log("Aggregation name-only candidate (not used):", {
      superbet: report.superbet,
      betano: report.betano,
      similarity: report.similarity,
    });
  },
  onStatus(status) {
    if (status.kind !== "stats") return;
    const { sessions, matching, opportunities } = status.stats;
    console.log("Aggregation:", {
      lines: Object.fromEntries(
        Object.entries(sessions).map(([provider, stats]) => [
          provider,
          `${stats.events} events / ${stats.lines} lines, lag ${stats.maxLagMs} ms`,
        ]),
      ),
      matching,
      opportunities,
    });
  },
  onError(error, provider) {
    console.error("Aggregation:", { provider, error });
  },
};
