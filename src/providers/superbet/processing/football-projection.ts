import type {
  SuperbetFootballChange,
  SuperbetFootballEvent,
  SuperbetFootballLine,
  SuperbetFootballProjectionHandlers,
  SuperbetFootballProjectionState,
  SuperbetFootballSnapshot,
} from "../model/football-projection.interfaces.js";
import type {
  SuperbetSnapshot,
  SuperbetUpdate,
} from "../model/state.interfaces.js";
import {
  footballEvent,
  footballLines,
  footballMarketKey,
} from "./football-markets.js";

/**
 * @file Maintains filtered football snapshots and emits only changed complete lines.
 */

const eventFields = [
  "id",
  "competitionId",
  "categoryId",
  "startsAt",
  "phase",
  "status",
  "offerStatus",
  "homeScore",
  "awayScore",
  "period",
  "minute",
  "stoppageTime",
] as const;
const lineFields = [
  "key",
  "marketId",
  "lineId",
  "offerStateId",
  "total",
  "handicap",
  "fromMinute",
  "toMinute",
  "firstMinutes",
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

function sameEvent(
  a: SuperbetFootballEvent,
  b: SuperbetFootballEvent,
): boolean {
  return (
    eventFields.every((key) => a[key] === b[key]) &&
    a.home.id === b.home.id &&
    a.home.name === b.home.name &&
    a.away.id === b.away.id &&
    a.away.name === b.away.name
  );
}

function sameLine(a: SuperbetFootballLine, b: SuperbetFootballLine): boolean {
  return (
    lineFields.every((key) => a[key] === b[key]) &&
    a.selections.every((selection, index) =>
      selectionFields.every(
        (key) => selection[key] === b.selections[index]![key],
      ),
    )
  );
}

export class SuperbetFootballProjection {
  private readonly events = new Map<number, SuperbetFootballProjectionState>();

  constructor(
    private readonly handlers: SuperbetFootballProjectionHandlers = {},
  ) {}

  // Build the filtered baseline after the vendor store has accepted synchronization.
  install(snapshot: SuperbetSnapshot, projectedAt = Date.now()): void {
    const event = footballEvent(snapshot);
    if (!event) {
      this.remove(snapshot.event_id, snapshot.increment_id, projectedAt);
      return;
    }
    const groups = new Map<string, Map<string, SuperbetFootballLine>>();
    for (const market of snapshot.markets) {
      const lines = footballLines(market, event);
      if (lines.size) groups.set(footballMarketKey(market), lines);
    }
    this.events.set(event.id, {
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
  ): SuperbetFootballChange | null {
    const state = this.events.get(snapshot.event_id);
    const event =
      state &&
      update.fixture === undefined &&
      update.inplay_stats === undefined &&
      update.inplay_stats_metadata === undefined
        ? state.event
        : footballEvent(snapshot);
    if (!event) {
      this.remove(snapshot.event_id, snapshot.increment_id, projectedAt);
      return null;
    }
    if (
      !state ||
      state.event.home.name !== event.home.name ||
      state.event.away.name !== event.away.name ||
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
            ...snapshot.markets.map(footballMarketKey),
          ])
        : new Set((update.markets ?? []).map(footballMarketKey));
    const upserts: SuperbetFootballLine[] = [];
    const removed: string[] = [];
    const sources =
      changed.size > 1
        ? new Map(
            snapshot.markets.map((market) => [
              footballMarketKey(market),
              market,
            ]),
          )
        : null;
    for (const key of changed) {
      const previous =
        state.groups.get(key) ?? new Map<string, SuperbetFootballLine>();
      const source = sources
        ? sources.get(key)
        : snapshot.markets.find((market) => footballMarketKey(market) === key);
      const next = source
        ? footballLines(source, event)
        : new Map<string, SuperbetFootballLine>();
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
    const change: SuperbetFootballChange = {
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

  getSnapshot(eventId: number): SuperbetFootballSnapshot | null {
    const state = this.events.get(eventId);
    return state
      ? {
          provider: "superbet",
          event: state.event,
          sourceVersion: state.sourceVersion,
          projectedAt: state.projectedAt,
          lines: [...state.groups.values()].flatMap((group) => [
            ...group.values(),
          ]),
        }
      : null;
  }

  // Discard the view on stale, removal, or shutdown; recovery installs a fresh baseline.
  remove(
    eventId: number,
    sourceVersion?: number,
    projectedAt = Date.now(),
  ): void {
    const state = this.events.get(eventId);
    if (!state) return;
    this.events.delete(eventId);
    this.handlers.onUpdate?.({
      kind: "invalidate",
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
