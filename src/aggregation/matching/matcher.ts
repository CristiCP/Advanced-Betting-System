import type { AggregationOptions } from "../model/config.interfaces.js";
import type {
  AggregationEvent,
  AggregationMatchingSummary,
  AggregationPair,
  AggregationPairReason,
  AggregationPairReport,
} from "../model/matching.interfaces.js";
import type {
  AggregationEventIdentity,
  AggregationProvider,
} from "../model/wire.interfaces.js";
import type { LearnedTables } from "./learning.js";
import { teamSimilarity } from "./names.js";
import type { AggregationSport } from "../model/tennis.interfaces.js";
import { tennisNameSimilarity } from "./tennis-names.js";

/**
 * @file Pairs events by Betradar ID and keeps every pair under continuous cross-checks.
 */

// Names count as evidence at this similarity; a swap must beat the provider orientation clearly.
export const nameEvidence = 0.5;
const swapMargin = 0.25;
// A running clock not refreshed for this long is too old to extrapolate.
const clockFreshMs = 10 * 60_000;
// Aliases and competitions are learned only from pairs confirmed this long without contradiction.
const learnAfterMs = 5 * 60_000;

export interface EventMatcherHandlers {
  onConfirmed(pair: AggregationPair): void;
  onUnconfirmed(pair: AggregationPair): void;
  onReport(report: AggregationPairReport): void;
}

// Estimated current clock in seconds, or NaN when unknown or stale.
export function clockAt(event: AggregationEvent, now: number): number {
  if (!event.clockKnown || !Number.isFinite(event.clockAt)) return NaN;
  if (!event.clockRunning) return event.clockSeconds;
  const elapsed = now - event.clockAt;
  return elapsed >= 0 && elapsed <= clockFreshMs
    ? event.clockSeconds + elapsed / 1_000
    : NaN;
}

export class EventMatcher {
  private readonly index: Record<
    AggregationProvider,
    Map<number, AggregationEvent[]>
  > = {
    superbet: new Map(),
    betano: new Map(),
  };
  private readonly conflicts = new Set<number>();
  readonly pairs = new Set<AggregationPair>();
  private readonly learned = new WeakSet<AggregationPair>();
  private nextPairId = 1;

  constructor(
    private readonly options: AggregationOptions,
    private readonly tables: LearnedTables,
    private readonly handlers: EventMatcherHandlers,
    private readonly sport: AggregationSport = "football",
  ) {}

  identityChanged(
    event: AggregationEvent,
    previous: AggregationEventIdentity | null,
    now: number,
  ): void {
    const before = previous?.betradarId ?? 0;
    const after = event.identity.betradarId;
    if (before !== after) {
      if (before > 0) {
        this.unindex(event, before);
        this.regroup(before, now);
      }
      if (after > 0) this.indexEvent(event, after);
    }
    if (after > 0) this.regroup(after, now);
    else if (event.pair) this.dissolve(event.pair, now);
  }

  liveChanged(event: AggregationEvent, now: number): void {
    if (event.pair) this.evaluate(event.pair, now);
  }

  removed(event: AggregationEvent, now: number): void {
    const id = event.identity.betradarId;
    if (event.pair) this.dissolve(event.pair, now);
    if (id > 0) {
      this.unindex(event, id);
      this.regroup(id, now);
    }
  }

  // Score disagreement only becomes a reason after it persists; learning waits for stability.
  sweep(now: number): void {
    for (const pair of this.pairs) {
      this.evaluate(pair, now);
      if (
        this.sport === "football" &&
        pair.state === "confirmed" &&
        !this.learned.has(pair) &&
        now - pair.confirmedSince >= learnAfterMs
      ) {
        this.learned.add(pair);
        this.tables.learn(pair);
      }
    }
  }

  summary(
    events: Record<AggregationProvider, Iterable<AggregationEvent>>,
    observed: number,
  ): AggregationMatchingSummary {
    const summary: AggregationMatchingSummary = {
      confirmed: 0,
      suspect: 0,
      conflicts: this.conflicts.size,
      unmatched: {
        superbet: { withId: 0, withoutId: 0 },
        betano: { withId: 0, withoutId: 0 },
      },
      observed,
      reasons: {},
      ...this.tables.sizes,
    };
    for (const pair of this.pairs) {
      summary[pair.state]++;
      for (const reason of pair.reasons)
        summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
    }
    for (const provider of ["superbet", "betano"] as const)
      for (const event of events[provider])
        if (event.pair === null && !event.conflict)
          summary.unmatched[provider][
            event.identity.betradarId > 0 ? "withId" : "withoutId"
          ]++;
    return summary;
  }

  private indexEvent(event: AggregationEvent, id: number): void {
    const list = this.index[event.provider].get(id);
    if (list) list.push(event);
    else this.index[event.provider].set(id, [event]);
  }

  private unindex(event: AggregationEvent, id: number): void {
    const list = this.index[event.provider].get(id);
    if (!list) return;
    const position = list.indexOf(event);
    if (position >= 0) list.splice(position, 1);
    if (list.length === 0) this.index[event.provider].delete(id);
  }

  // Exactly one event per provider forms a pair; duplicates on either side block the whole ID.
  private regroup(id: number, now: number): void {
    const superbet = this.index.superbet.get(id) ?? [];
    const betano = this.index.betano.get(id) ?? [];
    const conflict = superbet.length > 1 || betano.length > 1;
    for (const event of [...superbet, ...betano]) {
      event.conflict = conflict;
      const pair = event.pair;
      if (
        pair &&
        (conflict || pair.superbet !== superbet[0] || pair.betano !== betano[0])
      )
        this.dissolve(pair, now);
    }
    if (conflict) this.conflicts.add(id);
    else this.conflicts.delete(id);
    if (conflict || superbet.length !== 1 || betano.length !== 1) return;
    const left = superbet[0]!;
    const right = betano[0]!;
    const created = left.pair === null;
    const pair = left.pair ?? this.create(id, left, right, now);
    this.evaluate(pair, now, created);
  }

  private create(
    id: number,
    superbet: AggregationEvent,
    betano: AggregationEvent,
    now: number,
  ): AggregationPair {
    const pair: AggregationPair = {
      id: this.nextPairId++,
      betradarId: id,
      superbet,
      betano,
      // Starts suspect so the first evaluation reports and links a confirmation explicitly.
      state: "suspect",
      reasons: ["unverified"],
      similarity: 0,
      createdAt: now,
      confirmedSince: NaN,
      scoreMismatchSince: NaN,
      links: new Set(),
      settleUntil: 0,
    };
    superbet.pair = pair;
    betano.pair = pair;
    this.pairs.add(pair);
    return pair;
  }

  private dissolve(pair: AggregationPair, now: number): void {
    if (!this.pairs.delete(pair)) return;
    if (pair.state === "confirmed") this.handlers.onUnconfirmed(pair);
    if (pair.superbet.pair === pair) pair.superbet.pair = null;
    if (pair.betano.pair === pair) pair.betano.pair = null;
    this.handlers.onReport(this.report(pair, "removed", now));
  }

  // Every check must pass; an ID alone confirms nothing.
  private evaluate(pair: AggregationPair, now: number, created = false): void {
    const { superbet, betano } = pair;
    const reasons: AggregationPairReason[] = [];
    const aliases = this.tables.aliases;
    const startDifference = Math.abs(
      superbet.identity.startsAt - betano.identity.startsAt,
    );
    const startKnown = Number.isFinite(startDifference);
    if (startKnown && startDifference > this.options.startToleranceMs)
      reasons.push("start");
    if (
      superbet.home.markers !== betano.home.markers ||
      superbet.away.markers !== betano.away.markers
    )
      reasons.push("markers");
    const straight = Math.min(
      this.sport === "tennis"
        ? tennisNameSimilarity(superbet.home, betano.home)
        : teamSimilarity(superbet.home, betano.home, aliases),
      this.sport === "tennis"
        ? tennisNameSimilarity(superbet.away, betano.away)
        : teamSimilarity(superbet.away, betano.away, aliases),
    );
    const swapped = Math.min(
      this.sport === "tennis"
        ? tennisNameSimilarity(superbet.home, betano.away)
        : teamSimilarity(superbet.home, betano.away, aliases),
      this.sport === "tennis"
        ? tennisNameSimilarity(superbet.away, betano.home)
        : teamSimilarity(superbet.away, betano.home, aliases),
    );
    pair.similarity = Math.round(straight * 100) / 100;
    if (swapped >= nameEvidence && swapped > straight + swapMargin)
      reasons.push("orientation");
    if (this.sport === "tennis" && straight < 0.8) reasons.push("unverified");
    const synchronized = superbet.synchronized && betano.synchronized;
    if (!synchronized) {
      // A transport gap does not undo established identity, or count toward learning.
      pair.confirmedSince = NaN;
      pair.scoreMismatchSince = NaN;
      if (reasons.length === 0) {
        if (created) this.handlers.onReport(this.report(pair, pair.state, now));
        return;
      }
    }
    const clockDifference = Math.abs(
      clockAt(superbet, now) - clockAt(betano, now),
    );
    const clockKnown =
      synchronized &&
      superbet.live &&
      betano.live &&
      Number.isFinite(clockDifference);
    if (clockKnown && clockDifference > this.options.clockToleranceSeconds)
      reasons.push("clock");
    if (
      synchronized &&
      superbet.scoreKnown &&
      betano.scoreKnown &&
      (superbet.homeScore !== betano.homeScore ||
        superbet.awayScore !== betano.awayScore)
    ) {
      if (Number.isNaN(pair.scoreMismatchSince)) pair.scoreMismatchSince = now;
      if (now - pair.scoreMismatchSince >= this.options.scoreMismatchMs)
        reasons.push("score");
    } else pair.scoreMismatchSince = NaN;
    // Without name evidence, the start and the clock must both corroborate the ID.
    if (
      synchronized &&
      this.sport === "football" &&
      straight < nameEvidence &&
      !(
        startKnown &&
        clockKnown &&
        !reasons.includes("start") &&
        !reasons.includes("clock")
      )
    )
      reasons.push("unverified");
    const state = reasons.length ? "suspect" : "confirmed";
    const changed =
      state !== pair.state ||
      reasons.length !== pair.reasons.length ||
      reasons.some((reason, index) => reason !== pair.reasons[index]);
    const previous = pair.state;
    if (
      state !== previous ||
      (state === "confirmed" && Number.isNaN(pair.confirmedSince))
    )
      pair.confirmedSince = state === "confirmed" ? now : NaN;
    pair.reasons = reasons;
    pair.state = state;
    if (previous === "confirmed" && state !== "confirmed")
      this.handlers.onUnconfirmed(pair);
    if (previous !== "confirmed" && state === "confirmed")
      this.handlers.onConfirmed(pair);
    if (changed || created)
      this.handlers.onReport(this.report(pair, state, now));
  }

  private report(
    pair: AggregationPair,
    state: AggregationPairReport["state"],
    now: number,
  ): AggregationPairReport {
    return {
      kind: "pair",
      at: now,
      betradarId: pair.betradarId,
      superbetEventId: pair.superbet.identity.eventId,
      betanoEventId: pair.betano.identity.eventId,
      match: `${pair.superbet.identity.home} - ${pair.superbet.identity.away}`,
      betanoMatch: `${pair.betano.identity.home} - ${pair.betano.identity.away}`,
      state,
      reasons: [...pair.reasons],
      similarity: pair.similarity,
    };
  }
}
