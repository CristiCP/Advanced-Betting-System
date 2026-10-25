import type {
  SuperbetTennisChange,
  SuperbetTennisEvent,
  SuperbetTennisLine,
  SuperbetTennisProjectionHandlers,
  SuperbetTennisProjectionState,
  SuperbetTennisSnapshot,
} from "../model/tennis-projection.interfaces.js";
import type {
  SuperbetSnapshot,
  SuperbetUpdate,
} from "../model/state.interfaces.js";
import { tennisEvent, tennisLines, tennisMarketKey } from "./tennis-markets.js";

/**
 * @file Maintains filtered tennis snapshots and emits only changed complete lines.
 */

const eventFields = [
  "id",
  "betradarId",
  "competitionId",
  "categoryId",
  "startsAt",
  "phase",
  "status",
  "offerStatus",
  "player1Sets",
  "player2Sets",
  "player1Points",
  "player2Points",
  "serving",
] as const;
const lineFields = [
  "key",
  "marketId",
  "lineId",
  "offerStateId",
  "total",
  "handicap",
  "setNumber",
  "gameNumber",
] as const;
const selectionFields = [
  "id",
  "outcomeId",
  "role",
  "price",
  "status",
  "display",
  "handicap",
] as const;

function sameEvent(a: SuperbetTennisEvent, b: SuperbetTennisEvent): boolean {
  return (
    a === b ||
    (eventFields.every((key) => a[key] === b[key]) &&
      a.player1.id === b.player1.id &&
      a.player1.name === b.player1.name &&
      a.player2.id === b.player2.id &&
      a.player2.name === b.player2.name &&
      a.sets.length === b.sets.length &&
      a.sets.every((set, index) => {
        const other = b.sets[index]!;
        return (
          set.number === other.number &&
          set.player1Games === other.player1Games &&
          set.player2Games === other.player2Games &&
          set.sourceType === other.sourceType
        );
      }))
  );
}

function sameLine(a: SuperbetTennisLine, b: SuperbetTennisLine): boolean {
  return (
    lineFields.every((key) => a[key] === b[key]) &&
    a.selections.every((selection, index) =>
      selectionFields.every(
        (key) => selection[key] === b.selections[index]![key],
      ),
    )
  );
}

export class SuperbetTennisProjection {
  private readonly events = new Map<number, SuperbetTennisProjectionState>();

  constructor(
    private readonly handlers: SuperbetTennisProjectionHandlers = {},
  ) {}

  // Build the filtered baseline after the vendor store has accepted synchronization.
  install(snapshot: SuperbetSnapshot, projectedAt = Date.now()): void {
    const event = tennisEvent(snapshot);
    if (!event) {
      this.remove(snapshot.event_id, snapshot.increment_id, projectedAt);
      return;
    }
    const groups = new Map<string, Map<string, SuperbetTennisLine>>();
    for (const market of snapshot.markets) {
      const lines = tennisLines(market, event);
      if (lines.size) groups.set(tennisMarketKey(market), lines);
    }
    this.events.set(event.id, {
      synchronized: true,
      event,
      sourceVersion: snapshot.increment_id,
      projectedAt,
      groups,
    });
    if (this.handlers.onSnapshot)
      this.handlers.onSnapshot(this.getSnapshot(event.id)!);
  }

  // Rebuild only affected market groups; source versions may advance without a filtered change.
  update(
    snapshot: SuperbetSnapshot,
    update: SuperbetUpdate,
    projectedAt = Date.now(),
  ): SuperbetTennisChange | null {
    const state = this.events.get(snapshot.event_id);
    if (state && !state.synchronized) return null;
    const event =
      state &&
      update.fixture === undefined &&
      update.inplay_stats === undefined &&
      update.inplay_stats_metadata === undefined
        ? state.event
        : tennisEvent(snapshot);
    if (!event) {
      this.remove(snapshot.event_id, snapshot.increment_id, projectedAt);
      return null;
    }
    if (
      !state ||
      state.event.player1.name !== event.player1.name ||
      state.event.player1.id !== event.player1.id ||
      state.event.player2.name !== event.player2.name ||
      state.event.player2.id !== event.player2.id ||
      state.event.phase !== event.phase
    ) {
      this.install(snapshot, projectedAt);
      return null;
    }
    const changedEvent = !sameEvent(state.event, event);
    const changed =
      update.is_full_market_update === true || snapshot.markets.length === 0
        ? new Set([
            ...state.groups.keys(),
            ...snapshot.markets.map(tennisMarketKey),
          ])
        : new Set((update.markets ?? []).map(tennisMarketKey));
    const upserts: SuperbetTennisLine[] = [];
    const removed: string[] = [];
    const sources =
      changed.size > 1
        ? new Map(
            snapshot.markets.map((market) => [tennisMarketKey(market), market]),
          )
        : null;
    for (const key of changed) {
      const previous =
        state.groups.get(key) ?? new Map<string, SuperbetTennisLine>();
      const source = sources
        ? sources.get(key)
        : snapshot.markets.find((market) => tennisMarketKey(market) === key);
      const next = source
        ? tennisLines(source, event)
        : new Map<string, SuperbetTennisLine>();
      for (const [id, value] of previous)
        if (!next.has(id)) removed.push(value.key);
      for (const [id, value] of next) {
        const old = previous.get(id);
        if (!old || !sameLine(old, value)) upserts.push(value);
      }
      if (next.size) state.groups.set(key, next);
      else state.groups.delete(key);
    }
    state.event = event;
    state.sourceVersion = snapshot.increment_id;
    state.projectedAt = projectedAt;
    if (!changedEvent && upserts.length === 0 && removed.length === 0)
      return null;
    const change: SuperbetTennisChange = {
      kind: "update",
      eventId: event.id,
      sourceVersion: snapshot.increment_id,
      projectedAt,
      ...(changedEvent ? { event } : {}),
      upserts,
      removed,
    };
    this.handlers.onUpdate?.(change);
    return change;
  }

  getSnapshot(
    eventId: number,
    includeStale = false,
  ): SuperbetTennisSnapshot | null {
    const state = this.events.get(eventId);
    return state && (state.synchronized || includeStale)
      ? {
          provider: "superbet",
          event: state.event,
          sourceVersion: state.sourceVersion,
          projectedAt: state.projectedAt,
          synchronized: state.synchronized,
          lines: [...state.groups.values()].flatMap((group) => [
            ...group.values(),
          ]),
        }
      : null;
  }

  // Retain identity and lines, but block quotes until a complete baseline arrives.
  invalidate(eventId: number, projectedAt = Date.now()): void {
    const state = this.events.get(eventId);
    if (!state || !state.synchronized) return;
    state.synchronized = false;
    this.handlers.onUpdate?.({
      kind: "invalidate",
      eventId,
      sourceVersion: state.sourceVersion,
      projectedAt,
      upserts: [],
      removed: [],
    });
  }

  // Internal replay includes retained identities with an explicit synchronization flag.
  *snapshots(): IterableIterator<SuperbetTennisSnapshot> {
    for (const id of this.events.keys()) yield this.getSnapshot(id, true)!;
  }

  remove(
    eventId: number,
    sourceVersion?: number,
    projectedAt = Date.now(),
  ): void {
    const state = this.events.get(eventId);
    if (!state) return;
    this.events.delete(eventId);
    this.handlers.onUpdate?.({
      kind: "remove",
      eventId,
      sourceVersion: sourceVersion ?? state.sourceVersion,
      projectedAt,
      upserts: [],
      removed: [],
    });
  }
  clear(): void {
    for (const id of this.events.keys()) this.remove(id);
  }
}
