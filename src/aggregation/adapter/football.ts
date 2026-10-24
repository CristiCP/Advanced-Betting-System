import type {
  FootballAdapterEvent,
  FootballAdapterStats,
  FootballChangeLike,
  FootballCodec,
  FootballQuote,
  FootballSnapshotLike,
} from "../model/adapter.interfaces.js";
import type { AggregationMarketMapping } from "../model/mapping.interfaces.js";
import type { AggregationEventIdentity } from "../model/wire.interfaces.js";
import { mappingIndex } from "../mapping.js";
import { lineKey } from "../protocol/wire.js";
import type { AggregationOutbox } from "./outbox.js";

/**
 * @file Translates filtered football projections into canonical events and lines for the outbox.
 */

const totalKinds = new Set(["total", "asian-total"]);
const handicapKinds = new Set(["handicap", "asian-handicap"]);

// Canonical key of one vendor line under one mapping row, or null when the row does not apply.
export function footballLineKey(
  row: AggregationMarketMapping,
  kind: string,
  side: "superbet" | "betano",
  total: number | null,
  handicap: number | null,
  variant: number,
): number | null {
  if (row.threshold !== undefined) {
    // Betano answers yes/no without a line; Superbet must quote exactly the threshold.
    if (side === "betano" ? total !== null : total !== row.threshold)
      return null;
    return lineKey(row.code, row.threshold * 4, variant);
  }
  if (totalKinds.has(kind))
    return total === null ? null : lineKey(row.code, total * 4, variant);
  if (handicapKinds.has(kind))
    return handicap === null ? null : lineKey(row.code, handicap * 4, variant);
  if (kind === "yes-no" && total === null && handicap === null)
    return lineKey(row.code, 0, variant);
  return null;
}

function sameIdentity(
  a: AggregationEventIdentity,
  b: AggregationEventIdentity,
): boolean {
  return (
    a.eventId === b.eventId &&
    a.betradarId === b.betradarId &&
    (a.startsAt === b.startsAt ||
      (Number.isNaN(a.startsAt) && Number.isNaN(b.startsAt))) &&
    a.competitionId === b.competitionId &&
    a.categoryId === b.categoryId &&
    a.home === b.home &&
    a.away === b.away
  );
}

export class FootballAggregationAdapter<
  E extends { id: number },
  L extends { key: string },
> {
  private index = new Map<number, AggregationMarketMapping[]>();
  private readonly events = new Map<number, FootballAdapterEvent>();
  private readonly quote: FootballQuote = {
    priceA: NaN,
    priceB: NaN,
    usableA: false,
    usableB: false,
  };
  private readonly counters = { rejectedEvents: 0, ambiguousLines: 0 };

  constructor(
    private readonly outbox: AggregationOutbox,
    private readonly codec: FootballCodec<E, L>,
    private readonly snapshots: () => Iterable<FootballSnapshotLike<E, L>>,
  ) {}

  // Called by the outbox after attach or reset: rebuild from the provider's current projection.
  resync(): void {
    this.index = mappingIndex(this.codec.provider, this.outbox.conditions);
    this.events.clear();
    for (const snapshot of this.snapshots()) this.install(snapshot);
  }

  // A new baseline replaces the event: the aggregator must not mix lines from two baselines.
  install(snapshot: FootballSnapshotLike<E, L>): void {
    if (!this.outbox.active) return;
    const id = snapshot.event.id;
    this.release(id);
    const identity = this.codec.identity(snapshot.event);
    if (identity === null || !this.outbox.setEvent(identity)) {
      this.counters.rejectedEvents++;
      return;
    }
    const state: FootballAdapterEvent = {
      identity,
      lines: new Map(),
      owners: new Map(),
      ambiguous: new Set(),
    };
    this.events.set(id, state);
    this.outbox.setLive(id, this.codec.live(snapshot.event));
    for (const line of snapshot.lines) this.upsert(id, state, line);
  }

  update(change: FootballChangeLike<E, L>): void {
    if (!this.outbox.active) return;
    const id = change.eventId;
    if (change.kind === "invalidate") {
      this.release(id);
      return;
    }
    // A rejected event waits for its next baseline.
    const state = this.events.get(id);
    if (state === undefined) return;
    if (change.event !== undefined) {
      const identity = this.codec.identity(change.event);
      if (identity === null) {
        this.counters.rejectedEvents++;
        this.release(id);
        return;
      }
      if (!sameIdentity(identity, state.identity)) {
        this.outbox.setEvent(identity);
        state.identity = identity;
      }
      this.outbox.setLive(id, this.codec.live(change.event));
    }
    for (const key of change.removed) this.remove(id, state, key);
    for (const line of change.upserts) this.upsert(id, state, line);
  }

  getStats(): FootballAdapterStats {
    let lines = 0;
    for (const state of this.events.values()) lines += state.owners.size;
    return { events: this.events.size, lines, ...this.counters };
  }

  private release(id: number): void {
    if (this.events.delete(id)) this.outbox.releaseEvent(id);
  }

  private upsert(id: number, state: FootballAdapterEvent, line: L): void {
    const key = this.canonical(line);
    const previous = state.lines.get(line.key);
    if (previous !== undefined && previous !== key)
      this.remove(id, state, line.key);
    if (key === null || state.ambiguous.has(key)) return;
    const owner = state.owners.get(key);
    if (owner !== undefined && owner !== line.key) {
      // Two vendor lines claim one canonical line: comparing either would be a guess.
      this.outbox.releaseLine(id, key);
      state.owners.delete(key);
      state.lines.delete(owner);
      state.ambiguous.add(key);
      this.counters.ambiguousLines++;
      return;
    }
    state.lines.set(line.key, key);
    state.owners.set(key, line.key);
    this.codec.quote(line, this.quote);
    this.outbox.setLine(
      id,
      key,
      this.quote.priceA,
      this.quote.priceB,
      this.quote.usableA,
      this.quote.usableB,
    );
  }

  private remove(id: number, state: FootballAdapterEvent, vendorKey: string): void {
    const key = state.lines.get(vendorKey);
    if (key === undefined) return;
    state.lines.delete(vendorKey);
    if (state.owners.get(key) !== vendorKey) return;
    state.owners.delete(key);
    this.outbox.releaseLine(id, key);
  }

  private canonical(line: L): number | null {
    const rows = this.index.get(this.codec.marketType(line));
    if (rows === undefined) return null;
    for (const row of rows) {
      const key = this.codec.lineKey(line, row);
      if (key !== null) return key;
    }
    return null;
  }
}
