import type { AggregationOptions } from "../model/config.interfaces.js";
import type {
  AggregationEvent,
  AggregationPair,
} from "../model/matching.interfaces.js";
import type {
  AggregationCloseReason,
  AggregationGate,
  AggregationOpportunityReport,
  AggregationOpportunityState,
  AggregationOpportunityStats,
} from "../model/opportunity.interfaces.js";
import type { AggregationProvider } from "../model/wire.interfaces.js";
import { lineCode, lineQuarters, valueFlags } from "../protocol/wire.js";
import type { EventRegistry } from "./events.js";
import type { QuoteBook } from "./quotes.js";

/**
 * @file Evaluates linked two-outcome lines incrementally and tracks each opportunity's lifecycle.
 */

export interface MarketInfo {
  concept: string;
  labels: [string, string];
}

export interface DetectorSide {
  book: QuoteBook;
  registry: EventRegistry;
}

export interface DetectorHandlers {
  onReport(report: AggregationOpportunityReport): void;
}

export class Detector {
  private readonly pending: Uint8Array;
  private readonly pendingList: Uint32Array;
  private pendingCount = 0;
  private readonly open = new Map<number, AggregationOpportunityState>();
  private nextId = 1;
  private readonly counters = { opened: 0, closed: 0, suspicious: 0 };
  private compared = 0;
  private bestMarginBps = -Infinity;

  constructor(
    private readonly options: AggregationOptions,
    private readonly superbet: DetectorSide,
    private readonly betano: DetectorSide,
    private readonly markets: ReadonlyMap<number, MarketInfo>,
    private readonly lag: Readonly<Record<AggregationProvider, number>>,
    private readonly handlers: DetectorHandlers,
  ) {
    this.pending = new Uint8Array(options.maxLines);
    this.pendingList = new Uint32Array(options.maxLines);
  }

  // Marks are keyed by the Superbet line of a link; each line is evaluated once per batch.
  mark(superbetLine: number): void {
    if (this.pending[superbetLine]) return;
    this.pending[superbetLine] = 1;
    this.pendingList[this.pendingCount++] = superbetLine;
  }

  markLine(provider: AggregationProvider, line: number): void {
    const superbetLine =
      provider === "superbet" ? line : this.betano.book.peer[line]!;
    if (superbetLine >= 0 && this.superbet.book.peer[superbetLine]! >= 0)
      this.mark(superbetLine);
  }

  markPair(pair: AggregationPair): void {
    for (const line of pair.links) this.mark(line);
  }

  flush(now: number): void {
    for (let index = 0; index < this.pendingCount; index++) {
      const line = this.pendingList[index]!;
      this.pending[line] = 0;
      this.evaluate(line, now);
    }
    this.pendingCount = 0;
  }

  // A pair is compared only while every condition holds; the first failing one is the reason.
  gate(pair: AggregationPair | null, now: number): AggregationGate | null {
    if (pair === null || pair.state !== "confirmed") return "pair";
    const { superbet, betano } = pair;
    if (!superbet.live || !betano.live) return "not-live";
    if (superbet.suspended || betano.suspended) return "suspended";
    if (
      !superbet.scoreKnown ||
      !betano.scoreKnown ||
      superbet.homeScore !== betano.homeScore ||
      superbet.awayScore !== betano.awayScore
    )
      return "score";
    if (now < pair.settleUntil) return "settling";
    if (
      this.lag.superbet > this.options.maxLagMs ||
      this.lag.betano > this.options.maxLagMs
    )
      return "lag";
    return null;
  }

  // Open opportunities are re-checked on every sweep, so time-based gates close them without new prices.
  sweep(now: number): void {
    for (const line of this.open.keys()) this.mark(line);
    this.flush(now);
  }

  close(superbetLine: number, now: number, reason: AggregationCloseReason): void {
    const state = this.open.get(superbetLine);
    if (state === undefined) return;
    this.open.delete(superbetLine);
    this.counters.closed++;
    this.handlers.onReport({
      ...state.last,
      kind: "close",
      at: now,
      durationMs: now - state.openedAt,
      maxMarginBps: state.maxMarginBps,
      reason,
    });
  }

  closeAll(now: number, reason: AggregationCloseReason): void {
    for (const line of [...this.open.keys()]) this.close(line, now, reason);
  }

  // The best margin shows the comparison works even when no line crosses the threshold.
  getStats(linkedLines: number, resetWindow = false): AggregationOpportunityStats {
    const stats: AggregationOpportunityStats = {
      open: this.open.size,
      ...this.counters,
      linkedLines,
      compared: this.compared,
      bestMarginBps: Number.isFinite(this.bestMarginBps)
        ? this.bestMarginBps
        : null,
    };
    if (resetWindow) {
      this.compared = 0;
      this.bestMarginBps = -Infinity;
    }
    return stats;
  }

  private evaluate(line: number, now: number): void {
    const superbet = this.superbet.book;
    const betano = this.betano.book;
    const peer = superbet.peer[line]!;
    if (peer < 0) {
      this.close(line, now, "unlinked");
      return;
    }
    const event = this.superbet.registry.get(superbet.lineEvent[line]!);
    const pair = event?.pair ?? null;
    const blocked = this.gate(pair, now);
    if (blocked !== null) {
      this.close(line, now, blocked);
      return;
    }
    // Only the two cross-book combinations exist; a book against itself always carries its margin.
    const left = superbet.flags[line]!;
    const right = betano.flags[peer]!;
    let best = Infinity;
    let orientation = -1;
    if (left & valueFlags.usableA && right & valueFlags.usableB) {
      best = 1 / superbet.priceA[line]! + 1 / betano.priceB[peer]!;
      orientation = 0;
    }
    if (right & valueFlags.usableA && left & valueFlags.usableB) {
      const sum = 1 / betano.priceA[peer]! + 1 / superbet.priceB[line]!;
      if (sum < best) {
        best = sum;
        orientation = 1;
      }
    }
    const marginBps = Number.isFinite(best)
      ? Math.round((1 / best - 1) * 10_000 * 100) / 100
      : -Infinity;
    if (Number.isFinite(marginBps)) {
      this.compared++;
      if (marginBps > this.bestMarginBps) this.bestMarginBps = marginBps;
    }
    if (marginBps < this.options.minMarginBps) {
      this.close(line, now, "margin");
      return;
    }
    const priceA =
      orientation === 0 ? superbet.priceA[line]! : betano.priceA[peer]!;
    const priceB =
      orientation === 0 ? betano.priceB[peer]! : superbet.priceB[line]!;
    this.report(line, peer, pair!, orientation, priceA, priceB, best, marginBps, now);
  }

  private report(
    line: number,
    peer: number,
    pair: AggregationPair,
    orientation: number,
    priceA: number,
    priceB: number,
    sum: number,
    marginBps: number,
    now: number,
  ): void {
    let state = this.open.get(line);
    const changedLegs =
      state !== undefined &&
      (state.orientation !== orientation ||
        state.priceA !== priceA ||
        state.priceB !== priceB);
    if (
      state !== undefined &&
      !changedLegs &&
      state.marginBps === marginBps
    )
      return;
    const key = this.superbet.book.lineKey[line]!;
    const market = this.markets.get(lineCode(key));
    const suspicious = marginBps > this.options.suspiciousMarginBps;
    const providerA = orientation === 0 ? "superbet" : "betano";
    const providerB = orientation === 0 ? "betano" : "superbet";
    const updated = (provider: AggregationProvider): number =>
      now -
      (provider === "superbet"
        ? this.superbet.book.updatedAt[line]!
        : this.betano.book.updatedAt[peer]!);
    const { home, away } = pair.superbet.identity;
    const opening = state === undefined;
    const turned = state !== undefined && state.orientation !== orientation;
    const report: AggregationOpportunityReport = {
      kind: opening ? "open" : "update",
      id: state?.id ?? this.nextId++,
      at: now,
      betradarId: pair.betradarId,
      superbetEventId: pair.superbet.identity.eventId,
      betanoEventId: pair.betano.identity.eventId,
      match: `${pair.superbet.identity.home} - ${pair.superbet.identity.away}`,
      score: score(pair.superbet),
      marketCode: lineCode(key),
      concept: (market?.concept ?? "")
        .replaceAll("<HOME_TEAM>", home)
        .replaceAll("<AWAY_TEAM>", away),
      line: lineQuarters(key) / 4,
      legs: [
        {
          provider: providerA,
          outcome: "A",
          label: market?.labels[0] ?? "A",
          price: priceA,
          stakeShare: Math.round((1 / priceA / sum) * 10_000) / 10_000,
          ageMs: updated(providerA),
        },
        {
          provider: providerB,
          outcome: "B",
          label: market?.labels[1] ?? "B",
          price: priceB,
          stakeShare: Math.round((1 / priceB / sum) * 10_000) / 10_000,
          ageMs: updated(providerB),
        },
      ],
      marginBps,
      maxMarginBps: Math.max(state?.maxMarginBps ?? marginBps, marginBps),
      suspicious,
      openedAt: state?.openedAt ?? now,
      durationMs: now - (state?.openedAt ?? now),
    };
    if (state === undefined) {
      state = {
        id: report.id,
        superbetLine: line,
        betanoLine: peer,
        openedAt: now,
        orientation,
        priceA,
        priceB,
        marginBps,
        maxMarginBps: marginBps,
        reportedMarginBps: marginBps,
        last: report,
      };
      this.open.set(line, state);
      this.counters.opened++;
      if (suspicious) this.counters.suspicious++;
    } else {
      state.orientation = orientation;
      state.priceA = priceA;
      state.priceB = priceB;
      state.marginBps = marginBps;
      state.maxMarginBps = report.maxMarginBps;
      state.last = report;
    }
    // Price drifts below the report step are tracked but not reported; a new orientation always is.
    if (
      !opening &&
      !turned &&
      Math.abs(marginBps - state.reportedMarginBps) < this.options.reportStepBps
    )
      return;
    state.reportedMarginBps = marginBps;
    this.handlers.onReport(report);
  }
}

function score(event: AggregationEvent): string {
  return event.scoreKnown ? `${event.homeScore}-${event.awayScore}` : "?";
}
