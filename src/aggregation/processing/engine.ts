import { footballMarketMapping } from "../mapping.config.js";
import { isRoleA } from "../mapping.js";
import { LineLinker } from "../matching/lines.js";
import type { LearnedTables } from "../matching/learning.js";
import { EventMatcher } from "../matching/matcher.js";
import { teamSimilarity } from "../matching/names.js";
import type { AggregationOptions } from "../model/config.interfaces.js";
import type {
  AggregationEvent,
  AggregationMatchedEvent,
  AggregationMatchingSummary,
  AggregationObservedPair,
} from "../model/matching.interfaces.js";
import type {
  AggregationOpportunityStats,
  AggregationReport,
} from "../model/opportunity.interfaces.js";
import type { AggregationProviderSink } from "../model/session.interfaces.js";
import type {
  AggregationEventIdentity,
  AggregationProvider,
} from "../model/wire.interfaces.js";
import { WireError, lineCode } from "../protocol/wire.js";
import { superbetFootballMarkets } from "../../providers/superbet/football-markets.config.js";
import { superbetTennisMarkets } from "../../providers/superbet/tennis-markets.config.js";
import { tennisMarketMapping } from "../tennis-mapping.config.js";
import type {
  AggregationSport,
  AggregationTennisContext,
} from "../model/tennis.interfaces.js";
import type { AggregationCatalogDefinition } from "../model/mapping.interfaces.js";
import { tennisNameSimilarity } from "../matching/tennis-names.js";
import { Detector } from "./detector.js";
import type { MarketInfo } from "./detector.js";
import { EventRegistry } from "./events.js";
import { QuoteBook } from "./quotes.js";

/**
 * @file Connects validated provider state to matching, line linking, detection, and reporting.
 */

const fallbackBucketMs = 15 * 60_000;
// Name-only candidates need stronger names than an ID pair, because nothing else vouches for them.
const fallbackSimilarity = 0.7;
const maxPendingReports = 10_000;
const tennisCodes = new Set(
  tennisMarketMapping
    .filter((row) => row.enabled !== false)
    .map((row) => row.code),
);

export interface AggregationEngineHandlers {
  onRecord(report: AggregationReport): void;
}

export interface AggregationEngineStats {
  activeMatches: number;
  matching: AggregationMatchingSummary;
  opportunities: AggregationOpportunityStats;
  droppedReports: number;
}

// Labels come from the Superbet side of each mapping row; T rows read over/under there.
function marketInfo(sport: AggregationSport): Map<number, MarketInfo> {
  const definitions =
    sport === "tennis" ? superbetTennisMarkets : superbetFootballMarkets;
  const catalog = new Map<number, AggregationCatalogDefinition>(
    definitions.map((definition) => [definition.id, definition]),
  );
  const markets = new Map<number, MarketInfo>();
  for (const row of sport === "tennis"
    ? tennisMarketMapping
    : footballMarketMapping) {
    const roles = catalog.get(row.superbet)?.outcomes.map((o) => o.role) ?? [];
    const a = roles.find(isRoleA) ?? "A";
    const b = roles.find((role) => role !== a) ?? "B";
    markets.set(row.code, { concept: row.concept, labels: [a, b] });
  }
  return markets;
}

export class AggregationEngine {
  private readonly registries: Record<AggregationProvider, EventRegistry>;
  private readonly books: Record<AggregationProvider, QuoteBook>;
  private readonly lag: Record<AggregationProvider, number> = {
    superbet: 0,
    betano: 0,
  };
  private readonly matcher: EventMatcher;
  private readonly linker: LineLinker;
  private readonly detector: Detector;
  private observed = new Map<string, AggregationObservedPair>();
  private reports: AggregationReport[] = [];
  private droppedReports = 0;
  private now = 0;
  private lastSweep = 0;
  private matchesChanged = true;
  private matchSignature: string | null = null;

  constructor(
    private readonly options: AggregationOptions,
    private readonly tables: LearnedTables,
    private readonly handlers: AggregationEngineHandlers,
    private readonly sport: AggregationSport = "football",
  ) {
    this.registries = {
      superbet: new EventRegistry("superbet", options.maxEvents, sport),
      betano: new EventRegistry("betano", options.maxEvents, sport),
    };
    this.books = {
      superbet: new QuoteBook(options.maxLines),
      betano: new QuoteBook(options.maxLines),
    };
    this.detector = new Detector(
      options,
      { book: this.books.superbet, registry: this.registries.superbet },
      { book: this.books.betano, registry: this.registries.betano },
      marketInfo(sport),
      this.lag,
      {
        onReport: (report) => this.report({ ...report, type: "opportunity" }),
      },
      sport,
    );
    this.linker = new LineLinker(this.books.superbet, this.books.betano, {
      onLinked: (line) => this.detector.mark(line),
      onUnlinked: (line, cause) =>
        this.detector.close(line, this.now, "unlinked", cause),
    });
    this.matcher = new EventMatcher(
      options,
      tables,
      {
        onConfirmed: (pair) => {
          this.matchesChanged = true;
          this.linker.link(pair);
        },
        onUnconfirmed: (pair) => {
          this.matchesChanged = true;
          this.linker.unlink(pair);
        },
        onReport: (report) => this.report(report),
      },
      sport,
    );
  }

  sink(provider: AggregationProvider): AggregationProviderSink {
    return new ProviderSink(this, provider);
  }

  sweep(now: number): void {
    this.now = now;
    this.matcher.sweep(now);
    // Pairs whose settling period ended since the last sweep get compared again without new prices.
    for (const pair of this.matcher.pairs)
      if (pair.settleUntil > this.lastSweep && pair.settleUntil <= now)
        this.detector.markPair(pair);
    this.lastSweep = now;
    this.detector.sweep(now);
  }

  // Name-only candidates for events the ID matcher could not pair; reported, never compared.
  scan(now: number): void {
    if (this.options.fallbackMode === "off") {
      this.observed.clear();
      return;
    }
    const buckets = new Map<number, AggregationEvent[]>();
    for (const event of this.registries.betano.all()) {
      if (!this.unpaired(event)) continue;
      const bucket = Math.floor(event.identity.startsAt / fallbackBucketMs);
      const list = buckets.get(bucket);
      if (list) list.push(event);
      else buckets.set(bucket, [event]);
    }
    const span = Math.ceil(this.options.startToleranceMs / fallbackBucketMs);
    const found = new Map<AggregationEvent, AggregationEvent[]>();
    const claims = new Map<AggregationEvent, number>();
    for (const event of this.registries.superbet.all()) {
      if (!this.unpaired(event)) continue;
      const bucket = Math.floor(event.identity.startsAt / fallbackBucketMs);
      const candidates: AggregationEvent[] = [];
      for (let offset = -span; offset <= span; offset++)
        for (const other of buckets.get(bucket + offset) ?? [])
          if (this.candidate(event, other)) {
            candidates.push(other);
            claims.set(other, (claims.get(other) ?? 0) + 1);
          }
      found.set(event, candidates);
    }
    const next = new Map<string, AggregationObservedPair>();
    for (const [event, candidates] of found) {
      const other = candidates[0];
      if (candidates.length !== 1 || claims.get(other!) !== 1) continue;
      const key = `${event.identity.eventId}:${other!.identity.eventId}`;
      const known = this.observed.get(key);
      if (known) {
        next.set(key, known);
        continue;
      }
      const observed: AggregationObservedPair = {
        kind: "observed",
        at: now,
        superbetEventId: event.identity.eventId,
        betanoEventId: other!.identity.eventId,
        superbet: `${event.identity.home} - ${event.identity.away}`,
        betano: `${other!.identity.home} - ${other!.identity.away}`,
        startDifferenceMs: Math.abs(
          event.identity.startsAt - other!.identity.startsAt,
        ),
        similarity: this.similarity(event, other!),
      };
      next.set(key, observed);
      this.report(observed);
    }
    this.observed = next;
  }

  // Publish authoritative membership only; quote changes and transient re-pairing do not repeat the table.
  takeMatchedEvents(): AggregationMatchedEvent[] | null {
    if (!this.matchesChanged) return null;
    this.matchesChanged = false;
    const matches = [...this.matcher.pairs]
      .filter((pair) => pair.state === "confirmed")
      .map((pair) => ({
        sport: this.sport,
        betradarId: pair.betradarId,
        superbetEventId: pair.superbet.identity.eventId,
        betanoEventId: pair.betano.identity.eventId,
        superbetMatch: `${pair.superbet.identity.home} - ${pair.superbet.identity.away}`,
        betanoMatch: `${pair.betano.identity.home} - ${pair.betano.identity.away}`,
      }))
      .sort(
        (a, b) =>
          a.superbetEventId - b.superbetEventId ||
          a.betanoEventId - b.betanoEventId,
      );
    const signature = matches
      .map((match) => `${match.superbetEventId}:${match.betanoEventId}`)
      .join(",");
    if (signature === this.matchSignature) return null;
    this.matchSignature = signature;
    return matches;
  }

  takeReports(): AggregationReport[] {
    const reports = this.reports;
    this.reports = [];
    return reports;
  }

  stop(now: number): void {
    this.now = now;
    this.detector.closeAll(now, "stopped");
  }

  getStats(resetWindow = false): AggregationEngineStats {
    let linked = 0;
    let activeMatches = 0;
    for (const pair of this.matcher.pairs) {
      linked += pair.links.size;
      if (this.detector.canCompare(pair, this.now)) activeMatches++;
    }
    return {
      activeMatches,
      matching: this.matcher.summary(
        {
          superbet: this.registries.superbet.all(),
          betano: this.registries.betano.all(),
        },
        this.observed.size,
      ),
      opportunities: this.detector.getStats(linked, resetWindow),
      droppedReports: this.droppedReports,
    };
  }

  begin(now: number): void {
    this.now = now;
  }

  identity(
    provider: AggregationProvider,
    handle: number,
    identity: AggregationEventIdentity,
  ): void {
    const { event, previous } = this.registries[provider].identify(
      handle,
      identity,
    );
    this.matcher.identityChanged(event, previous, this.now);
  }

  live(
    provider: AggregationProvider,
    handle: number,
    flags: number,
    homeScore: number,
    awayScore: number,
    clockSeconds: number,
  ): void {
    const event = this.registries[provider].get(handle)!;
    const scoreChanged = this.registries[provider].live(
      event,
      flags,
      homeScore,
      awayScore,
      clockSeconds,
      this.now,
    );
    const pair = event.pair;
    if (pair && scoreChanged)
      pair.settleUntil = this.now + this.options.scoreSettleMs;
    this.matcher.liveChanged(event, this.now);
    if (event.pair) this.detector.markPair(event.pair);
  }

  release(provider: AggregationProvider, handle: number): void {
    const event = this.registries[provider].release(handle);
    if (event) {
      if (event.pair)
        this.linker.unlink(event.pair, { kind: "event-withdrawn", provider });
      this.matcher.removed(event, this.now);
    }
  }

  tennis(
    provider: AggregationProvider,
    handle: number,
    context: AggregationTennisContext,
  ): void {
    if (this.sport !== "tennis")
      throw new WireError("Tennis context on a football channel.");
    const event = this.registries[provider].get(handle)!;
    event.tennis = context;
    if (event.pair) this.detector.markPair(event.pair);
  }

  defineLine(
    provider: AggregationProvider,
    line: number,
    handle: number,
    key: number,
  ): void {
    const event = this.registries[provider].get(handle)!;
    if (this.sport === "tennis" && !tennisCodes.has(lineCode(key)))
      throw new WireError("Unknown or disabled tennis market code.");
    if (event.lines.has(key))
      throw new WireError("Line key is already defined for this event.");
    event.lines.set(key, line);
    this.books[provider].define(line, handle, key);
    this.linker.lineDefined(event, key, line);
  }

  releaseLine(provider: AggregationProvider, line: number): void {
    const book = this.books[provider];
    const event = this.registries[provider].get(book.lineEvent[line]!)!;
    this.linker.lineReleased(event, line);
    event.lines.delete(book.lineKey[line]!);
    book.release(line);
  }

  value(
    provider: AggregationProvider,
    line: number,
    priceA: number,
    priceB: number,
    flags: number,
  ): void {
    this.books[provider].value(line, priceA, priceB, flags, this.now);
    this.detector.markLine(provider, line);
  }

  // A provider whose batches arrive late blocks all its pairs until the delay recovers.
  commit(provider: AggregationProvider, sentAt: number): void {
    const before = this.lag[provider] > this.options.maxLagMs;
    this.lag[provider] = Math.max(0, this.now - sentAt);
    if (before !== this.lag[provider] > this.options.maxLagMs)
      for (const pair of this.matcher.pairs) this.detector.markPair(pair);
    this.detector.flush(this.now);
  }

  clear(provider: AggregationProvider): void {
    for (const event of this.registries[provider].all()) {
      if (event.pair)
        this.linker.unlink(event.pair, { kind: "provider-cleared", provider });
      this.matcher.removed(event, this.now);
    }
    this.registries[provider].clear();
    this.books[provider].clear();
    this.lag[provider] = 0;
    this.detector.flush(this.now);
  }

  private unpaired(event: AggregationEvent): boolean {
    return (
      event.pair === null &&
      !event.conflict &&
      event.live &&
      Number.isFinite(event.identity.startsAt)
    );
  }

  private similarity(a: AggregationEvent, b: AggregationEvent): number {
    if (this.sport === "tennis")
      return Math.min(
        tennisNameSimilarity(a.home, b.home),
        tennisNameSimilarity(a.away, b.away),
      );
    const aliases = this.tables.aliases;
    return (
      Math.round(
        Math.min(
          teamSimilarity(a.home, b.home, aliases),
          teamSimilarity(a.away, b.away, aliases),
        ) * 100,
      ) / 100
    );
  }

  private candidate(
    superbet: AggregationEvent,
    betano: AggregationEvent,
  ): boolean {
    const left = superbet.identity;
    const right = betano.identity;
    // Two different IDs are two different matches, whatever the names say.
    if (left.betradarId > 0 && right.betradarId > 0) return false;
    if (
      Math.abs(left.startsAt - right.startsAt) > this.options.startToleranceMs
    )
      return false;
    if (
      superbet.home.markers !== betano.home.markers ||
      superbet.away.markers !== betano.away.markers
    )
      return false;
    const competition = this.tables.competition(left.competitionId);
    if (
      competition !== undefined &&
      right.competitionId > 0 &&
      competition !== right.competitionId
    )
      return false;
    return this.similarity(superbet, betano) >= fallbackSimilarity;
  }

  private report(report: AggregationReport): void {
    report = { ...report, sport: this.sport };
    this.handlers.onRecord(report);
    this.reports.push(report);
    if (this.reports.length > maxPendingReports) {
      this.reports.shift();
      this.droppedReports++;
    }
  }
}

class ProviderSink implements AggregationProviderSink {
  constructor(
    private readonly engine: AggregationEngine,
    private readonly provider: AggregationProvider,
  ) {}

  begin(now: number): void {
    this.engine.begin(now);
  }
  commit(sentAt: number): void {
    this.engine.commit(this.provider, sentAt);
  }
  clear(): void {
    this.engine.clear(this.provider);
  }
  reset(): void {
    this.engine.clear(this.provider);
  }
  eventIdentity(event: number, identity: AggregationEventIdentity): void {
    this.engine.identity(this.provider, event, identity);
  }
  eventLive(
    event: number,
    flags: number,
    homeScore: number,
    awayScore: number,
    clockSeconds: number,
  ): void {
    this.engine.live(
      this.provider,
      event,
      flags,
      homeScore,
      awayScore,
      clockSeconds,
    );
  }
  eventRelease(event: number): void {
    this.engine.release(this.provider, event);
  }
  eventTennis(event: number, context: AggregationTennisContext): void {
    this.engine.tennis(this.provider, event, context);
  }
  lineDefine(line: number, event: number, key: number): void {
    this.engine.defineLine(this.provider, line, event, key);
  }
  lineRelease(line: number): void {
    this.engine.releaseLine(this.provider, line);
  }
  value(line: number, priceA: number, priceB: number, flags: number): void {
    this.engine.value(this.provider, line, priceA, priceB, flags);
  }
}
