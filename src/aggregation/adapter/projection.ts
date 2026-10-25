import type {
  ProjectionAdapterEvent,
  ProjectionAdapterStats,
  ProjectionChangeLike,
  ProjectionCodec,
  ProjectionQuote,
  ProjectionSnapshotLike,
} from "../model/adapter.interfaces.js";
import type { AggregationMarketMapping } from "../model/mapping.interfaces.js";
import type { AggregationEventIdentity } from "../model/wire.interfaces.js";
import { mappingIndex } from "../mapping.js";
import type { AggregationOutbox } from "./outbox.js";
import { footballMarketMapping } from "../mapping.config.js";

/**
 * @file Translates filtered sport projections into canonical events and reconciles line ownership.
 */

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

export class ProjectionAggregationAdapter<
  E extends { id: number },
  L extends { key: string },
> {
  private index = new Map<number, AggregationMarketMapping[]>();
  private readonly events = new Map<number, ProjectionAdapterEvent>();
  private readonly quote: ProjectionQuote = {
    priceA: NaN,
    priceB: NaN,
    usableA: false,
    usableB: false,
  };
  private readonly counters = { rejectedEvents: 0, ambiguousLines: 0 };

  constructor(
    private readonly outbox: AggregationOutbox,
    private readonly codec: ProjectionCodec<E, L>,
    private readonly snapshots: () => Iterable<ProjectionSnapshotLike<E, L>>,
    private readonly mapping: readonly AggregationMarketMapping[] = footballMarketMapping,
  ) {}

  // Called by the outbox after attach or reset: rebuild from the provider's current projection.
  resync(): void {
    this.index = mappingIndex(
      this.codec.provider,
      this.outbox.conditions,
      this.mapping,
    );
    this.events.clear();
    for (const snapshot of this.snapshots()) this.install(snapshot);
  }

  // Reconcile a complete baseline by canonical key without releasing surviving handles.
  install(snapshot: ProjectionSnapshotLike<E, L>): void {
    if (!this.outbox.active) return;
    const id = snapshot.event.id;
    const previous = this.events.get(id);
    const identity = this.codec.identity(snapshot.event);
    if (identity === null) {
      this.release(id);
      this.counters.rejectedEvents++;
      return;
    }
    if (
      (!previous || !sameIdentity(identity, previous.identity)) &&
      !this.outbox.setEvent(identity)
    ) {
      this.release(id);
      this.counters.rejectedEvents++;
      return;
    }
    const state: ProjectionAdapterEvent = {
      identity,
      lines: new Map(),
      owners: new Map(),
      ambiguous: new Set(),
    };
    const next = new Map<number, L>();
    for (const line of snapshot.lines) {
      const key = this.canonical(line);
      if (key === null || state.ambiguous.has(key)) continue;
      const owner = next.get(key);
      if (owner !== undefined && owner.key !== line.key) {
        next.delete(key);
        state.ambiguous.add(key);
        this.counters.ambiguousLines++;
      } else next.set(key, line);
    }
    // Vendor IDs may change across baselines; only a missing canonical line is withdrawn.
    if (previous)
      for (const key of previous.owners.keys())
        if (!next.has(key)) this.outbox.releaseLine(id, key);
    this.events.set(id, state);
    const live = {
      ...this.codec.live(snapshot.event),
      synchronized: snapshot.synchronized !== false,
    };
    if (previous === undefined) this.outbox.setLive(id, live);
    for (const line of next.values()) this.upsert(id, state, line);
    // Publish availability after the replacement values; the receiver evaluates at batch commit.
    this.outbox.setLive(id, live);
  }

  update(change: ProjectionChangeLike<E, L>): void {
    if (!this.outbox.active) return;
    const id = change.eventId;
    if (change.kind === "invalidate") {
      this.outbox.setSynchronized(id, false);
      return;
    }
    if (change.kind === "remove") {
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

  getStats(): ProjectionAdapterStats {
    let lines = 0;
    for (const state of this.events.values()) lines += state.owners.size;
    return { events: this.events.size, lines, ...this.counters };
  }

  private release(id: number): void {
    if (this.events.delete(id)) this.outbox.releaseEvent(id);
  }

  private upsert(id: number, state: ProjectionAdapterEvent, line: L): void {
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

  private remove(
    id: number,
    state: ProjectionAdapterEvent,
    vendorKey: string,
  ): void {
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
