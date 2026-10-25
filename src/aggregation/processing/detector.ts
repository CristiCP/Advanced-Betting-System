import type { AggregationOptions } from "../model/config.interfaces.js";
import type {
  AggregationEvent,
  AggregationPair,
} from "../model/matching.interfaces.js";
import type {
  AggregationCloseReason,
  AggregationGate,
  AggregationOpportunityLeg,
  AggregationOpportunityReport,
  AggregationOpportunityState,
  AggregationOpportunityStats,
  AggregationUnlinkCause,
} from "../model/opportunity.interfaces.js";
import type { AggregationProvider } from "../model/wire.interfaces.js";
import {
  lineCode,
  lineQuarters,
  lineVariant,
  valueFlags,
} from "../protocol/wire.js";
import {
  tennisContextAgrees,
  advantageTennisScore,
} from "../protocol/tennis.js";
import type { AggregationSport } from "../model/tennis.interfaces.js";
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
    private readonly sport: AggregationSport = "football",
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
    if (!superbet.synchronized || !betano.synchronized) return "stale";
    if (!superbet.live || !betano.live) return "not-live";
    if (superbet.suspended || betano.suspended) return "suspended";
    if (
      !superbet.scoreKnown ||
      !betano.scoreKnown ||
      superbet.homeScore !== betano.homeScore ||
      superbet.awayScore !== betano.awayScore
    )
      return "score";
    if (
      this.sport === "tennis" &&
      !tennisContextAgrees(superbet.tennis, betano.tennis)
    )
      return "tennis-context";
    if (now < pair.settleUntil) return "settling";
    if (
      this.lag.superbet > this.options.maxLagMs ||
      this.lag.betano > this.options.maxLagMs
    )
      return "lag";
    return null;
  }

  // Count a match once when a common line can be compared, regardless of its margin.
  canCompare(pair: AggregationPair, now: number): boolean {
    if (this.gate(pair, now) !== null) return false;
    for (const line of pair.links) {
      const peer = this.superbet.book.peer[line]!;
      if (
        peer >= 0 &&
        !this.completedSet(pair, line) &&
        this.usableOrientations(line, peer) !== 0
      )
        return true;
    }
    return false;
  }

  private completedSet(pair: AggregationPair, line: number): boolean {
    if (this.sport !== "tennis") return false;
    const set = lineVariant(this.superbet.book.lineKey[line]!);
    return set > 0 && set < pair.superbet.tennis!.currentSet!;
  }

  private usableOrientations(line: number, peer: number): number {
    const left = this.superbet.book.flags[line]!;
    const right = this.betano.book.flags[peer]!;
    return (
      (left & valueFlags.usableA && right & valueFlags.usableB ? 1 : 0) |
      (right & valueFlags.usableA && left & valueFlags.usableB ? 2 : 0)
    );
  }

  // Open opportunities are re-checked on every sweep, so time-based gates close them without new prices.
  sweep(now: number): void {
    for (const line of this.open.keys()) this.mark(line);
    this.flush(now);
  }

  close(
    superbetLine: number,
    now: number,
    reason: AggregationCloseReason,
    cause?: AggregationUnlinkCause,
  ): void {
    const state = this.open.get(superbetLine);
    if (state === undefined) return;
    this.open.delete(superbetLine);
    this.counters.closed++;
    // Capture the closing prices even when the final move was below the report threshold.
    const latestLeg = (
      leg: AggregationOpportunityLeg,
    ): AggregationOpportunityLeg => {
      const book =
        leg.provider === "superbet" ? this.superbet.book : this.betano.book;
      const line =
        leg.provider === "superbet" ? state.superbetLine : state.betanoLine;
      const price =
        leg.outcome === "A" ? book.priceA[line]! : book.priceB[line]!;
      const available =
        book.lineEvent[line]! >= 0 && Number.isFinite(price) && price > 1;
      return {
        ...leg,
        price: available ? price : leg.price,
        ageMs: available
          ? now - book.updatedAt[line]!
          : leg.ageMs + now - state.last.at,
      };
    };
    const legs: [AggregationOpportunityLeg, AggregationOpportunityLeg] = [
      latestLeg(state.last.legs[0]),
      latestLeg(state.last.legs[1]),
    ];
    const sum = 1 / legs[0].price + 1 / legs[1].price;
    const marginBps = Math.round((1 / sum - 1) * 10_000 * 100) / 100;
    for (const leg of legs)
      leg.stakeShare = Math.round((1 / leg.price / sum) * 10_000) / 10_000;
    const event = this.superbet.registry.get(
      this.superbet.book.lineEvent[superbetLine]!,
    );
    this.handlers.onReport({
      ...state.last,
      kind: "close",
      at: now,
      score: event ? score(event) : state.last.score,
      legs,
      marginBps,
      suspicious: marginBps > this.options.suspiciousMarginBps,
      durationMs: now - state.openedAt,
      unconfirmedMs:
        state.unconfirmedMs +
        (state.pausedAt === null ? 0 : now - state.pausedAt),
      maxMarginBps: state.maxMarginBps,
      reason,
      reasonDetail: this.describeClose(state, reason, marginBps, cause),
    });
  }

  // Explain only observed local causes; unusable flags do not identify a vendor's suspension policy.
  private describeClose(
    state: AggregationOpportunityState,
    reason: AggregationCloseReason,
    marginBps: number,
    cause?: AggregationUnlinkCause,
  ): string {
    const superbet = this.superbet.registry.get(
      this.superbet.book.lineEvent[state.superbetLine]!,
    );
    const betano = this.betano.registry.get(
      this.betano.book.lineEvent[state.betanoLine]!,
    );
    const events = [superbet, betano].filter((event) => event !== undefined);
    const changes: string[] = [];
    const unavailable: string[] = [];
    for (const leg of state.last.legs) {
      const book =
        leg.provider === "superbet" ? this.superbet.book : this.betano.book;
      const line =
        leg.provider === "superbet" ? state.superbetLine : state.betanoLine;
      const price =
        leg.outcome === "A" ? book.priceA[line]! : book.priceB[line]!;
      const usable =
        leg.outcome === "A" ? valueFlags.usableA : valueFlags.usableB;
      const valid =
        book.lineEvent[line]! >= 0 && Number.isFinite(price) && price > 1;
      if (!valid || !(book.flags[line]! & usable))
        unavailable.push(`${leg.provider} ${leg.label} indisponibilă`);
      if (valid && price !== leg.price)
        changes.push(`${leg.provider} ${leg.label}: ${leg.price} -> ${price}`);
    }
    const percent = (bps: number): string => `${(bps / 100).toFixed(2)}%`;
    let detail: string;
    switch (reason) {
      case "stale":
        detail = `${events
          .filter((event) => !event.synchronized)
          .map((event) => event.provider)
          .join(", ")}: date neconfirmate, resincronizare în curs`;
        break;
      case "margin":
        detail = unavailable.length
          ? `${unavailable.join(", ")}; nicio combinație utilizabilă nu atinge pragul ${percent(this.options.minMarginBps)}`
          : `marja ${percent(marginBps)} sub pragul ${percent(this.options.minMarginBps)}`;
        break;
      case "unlinked": {
        const source = cause?.provider ?? "provider necunoscut";
        const pair = superbet?.pair ?? betano?.pair;
        if (cause?.kind === "line-withdrawn")
          detail = `${source}: linia de pariu a fost retrasă din starea agregată`;
        else if (cause?.kind === "event-withdrawn")
          detail = `${source}: starea meciului a fost retrasă din agregator`;
        else if (cause?.kind === "provider-cleared")
          detail = `${source}: starea agregată a providerului a fost eliminată`;
        else if (superbet?.conflict || betano?.conflict)
          detail = "asociere retrasă: ID Betradar duplicat";
        else
          detail = `perechea nu mai este confirmată${pair?.reasons.length ? ` (${pair.reasons.join(", ")})` : ""}`;
        break;
      }
      case "not-live":
        detail = `${events
          .filter((event) => !event.live)
          .map((event) => event.provider)
          .join(", ")}: meciul nu mai este live`;
        break;
      case "suspended":
        detail = `${events
          .filter((event) => event.suspended)
          .map((event) => event.provider)
          .join(", ")}: meci suspendat`;
        break;
      case "score":
        detail = `scoruri diferite/lipsă: superbet ${superbet ? score(superbet) : "?"}, betano ${betano ? score(betano) : "?"}`;
        break;
      case "tennis-context":
        detail = `context tenis diferit/lipsă sau set încheiat: superbet ${superbet ? score(superbet) : "?"}, betano ${betano ? score(betano) : "?"}`;
        break;
      case "settling":
        detail = "pauză de stabilizare după schimbarea scorului";
        break;
      case "lag":
        detail = (["superbet", "betano"] as const)
          .filter((provider) => this.lag[provider] > this.options.maxLagMs)
          .map(
            (provider) =>
              `${provider}: batch întârziat ${this.lag[provider]}ms > ${this.options.maxLagMs}ms`,
          )
          .join(", ");
        break;
      case "pair":
        detail = "perechea de meciuri nu mai este confirmată";
        break;
      case "stopped":
        detail = "oprirea aplicației";
        break;
    }
    return changes.length
      ? `${detail}; cote schimbate: ${changes.join(", ")}`
      : detail;
  }

  closeAll(now: number, reason: AggregationCloseReason): void {
    for (const line of [...this.open.keys()]) this.close(line, now, reason);
  }

  // The best margin shows the comparison works even when no line crosses the threshold.
  getStats(
    linkedLines: number,
    resetWindow = false,
  ): AggregationOpportunityStats {
    let paused = 0;
    for (const state of this.open.values())
      if (state.pausedAt !== null) paused++;
    const stats: AggregationOpportunityStats = {
      open: this.open.size - paused,
      paused,
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
    let blocked = this.gate(pair, now);
    if (blocked === null && this.completedSet(pair!, line))
      blocked = "tennis-context";
    if (blocked === "stale") {
      const state = this.open.get(line);
      if (state !== undefined && state.pausedAt === null) {
        state.pausedAt = now;
        this.handlers.onReport({
          ...state.last,
          kind: "pause",
          at: now,
          durationMs: now - state.openedAt,
          unconfirmedMs: state.unconfirmedMs,
          reason: "stale",
          reasonDetail: this.describeClose(state, "stale", state.marginBps),
        });
      }
      return;
    }
    if (blocked !== null) {
      this.close(line, now, blocked);
      return;
    }
    // Only the two cross-book combinations exist; a book against itself always carries its margin.
    const orientations = this.usableOrientations(line, peer);
    let best = Infinity;
    let orientation = -1;
    if (orientations & 1) {
      best = 1 / superbet.priceA[line]! + 1 / betano.priceB[peer]!;
      orientation = 0;
    }
    if (orientations & 2) {
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
    this.report(
      line,
      peer,
      pair!,
      orientation,
      priceA,
      priceB,
      best,
      marginBps,
      now,
    );
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
    const resuming = state !== undefined && state.pausedAt !== null;
    const changedLegs =
      state !== undefined &&
      (state.orientation !== orientation ||
        state.priceA !== priceA ||
        state.priceB !== priceB);
    if (
      state !== undefined &&
      !resuming &&
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
      kind: opening ? "open" : resuming ? "resume" : "update",
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
        .replaceAll("<AWAY_TEAM>", away)
        .replaceAll("<PLAYER_1>", home)
        .replaceAll("<PLAYER_2>", away)
        .replaceAll("<SET>", String(lineVariant(key))),
      line: lineQuarters(key) / 4,
      legs: [
        {
          provider: providerA,
          outcome: "A",
          label: this.label(
            market?.labels[0] ?? "A",
            home,
            away,
            lineQuarters(key) / 4,
          ),
          price: priceA,
          stakeShare: Math.round((1 / priceA / sum) * 10_000) / 10_000,
          ageMs: updated(providerA),
        },
        {
          provider: providerB,
          outcome: "B",
          label: this.label(
            market?.labels[1] ?? "B",
            home,
            away,
            lineQuarters(key) / 4,
          ),
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
      unconfirmedMs:
        (state?.unconfirmedMs ?? 0) + (resuming ? now - state!.pausedAt! : 0),
    };
    if (state === undefined) {
      state = {
        id: report.id,
        superbetLine: line,
        betanoLine: peer,
        openedAt: now,
        pausedAt: null,
        unconfirmedMs: 0,
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
      state.pausedAt = null;
      state.unconfirmedMs = report.unconfirmedMs;
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
      !resuming &&
      !turned &&
      Math.abs(marginBps - state.reportedMarginBps) < this.options.reportStepBps
    )
      return;
    state.reportedMarginBps = marginBps;
    this.handlers.onReport(report);
  }

  private label(
    role: string,
    home: string,
    away: string,
    value: number,
  ): string {
    if (this.sport !== "tennis") return role;
    if (role === "over" || role === "under")
      return `${role === "over" ? "Peste" : "Sub"} ${value}`;
    if (role === "yes" || role === "no") return role === "yes" ? "Da" : "Nu";
    const handicap = role === "player2" ? -value : value;
    return `${role === "player1" ? home : away} ${handicap > 0 ? "+" : ""}${handicap}`;
  }
}

function score(event: AggregationEvent): string {
  if (event.tennis) {
    const point = (value: number | null) =>
      value === null
        ? "?"
        : value === advantageTennisScore
          ? "AD"
          : String(value);
    return `seturi ${event.scoreKnown ? `${event.homeScore}-${event.awayScore}` : "?"}; game-uri ${event.tennis.sets.map((set) => `${set[0] ?? "?"}-${set[1] ?? "?"}`).join(",")}; puncte ${point(event.tennis.points[0])}-${point(event.tennis.points[1])}; serviciu ${event.tennis.server || "?"}`;
  }
  return event.scoreKnown ? `${event.homeScore}-${event.awayScore}` : "?";
}
