import { betanoTennisMarkets } from "../tennis-markets.config.js";
import type {
  BetanoDiff,
  BetanoMarket,
  BetanoSnapshot,
} from "../model/state.interfaces.js";
import type {
  BetanoTennisChange,
  BetanoTennisEvent,
  BetanoTennisLine,
  BetanoTennisProjectionHandlers,
  BetanoTennisProjectionState,
  BetanoTennisSnapshot,
} from "../model/tennis-projection.interfaces.js";
import { tennisEvent, tennisLines } from "./tennis-markets.js";
import { isRecord } from "./state.js";

/**
 * @file Maintains filtered tennis state after ordered vendor patches and emits changed lines.
 */

const catalogTypes = new Set<number>(betanoTennisMarkets.map((m) => m.typeId));

function sameEvent(a: BetanoTennisEvent, b: BetanoTennisEvent): boolean {
  return (Object.keys(a) as (keyof BetanoTennisEvent)[]).every((key) => {
    if (key === "player1" || key === "player2") {
      const x = a[key],
        y = b[key];
      return (
        x.id === y.id &&
        x.name === y.name &&
        x.playerIds.length === y.playerIds.length &&
        x.playerIds.every((id, i) => id === y.playerIds[i])
      );
    }
    if (key === "sets")
      return (
        a.sets.length === b.sets.length &&
        a.sets.every((set, i) => {
          const other = b.sets[i]!;
          return (
            set.number === other.number &&
            set.player1Games === other.player1Games &&
            set.player2Games === other.player2Games
          );
        })
      );
    return a[key] === b[key];
  });
}

function sameLine(a: BetanoTennisLine, b: BetanoTennisLine): boolean {
  return (
    a.marketTypeId === b.marketTypeId &&
    a.total === b.total &&
    a.handicap === b.handicap &&
    a.isSuspended === b.isSuspended &&
    a.setNumber === b.setNumber &&
    a.gameNumber === b.gameNumber &&
    a.selections.every((s, i) => {
      const other = b.selections[i]!;
      return (
        s.id === other.id &&
        s.outcomeId === other.outcomeId &&
        s.role === other.role &&
        s.price === other.price &&
        s.isSuspended === other.isSuspended &&
        s.handicap === other.handicap
      );
    })
  );
}

export class BetanoTennisProjection {
  private readonly events = new Map<number, BetanoTennisProjectionState>();

  constructor(private readonly handlers: BetanoTennisProjectionHandlers = {}) {}

  install(snapshot: BetanoSnapshot, projectedAt = Date.now()): void {
    const event = tennisEvent(snapshot);
    if (!event) {
      this.remove(snapshot.event.id, snapshot.version, projectedAt);
      return;
    }
    const state: BetanoTennisProjectionState = {
      synchronized: true,
      event,
      sourceVersion: snapshot.version,
      projectedAt,
      groups: new Map(),
      activeMarkets: new Set(snapshot.event.marketIdList),
      selectionMarkets: new Map(),
      marketSelections: new Map(),
    };
    for (const id of state.activeMarkets) {
      const market = snapshot.markets[id];
      if (!market) continue;
      this.index(state, id, market);
      const lines = tennisLines(market, snapshot, event);
      if (lines.size) state.groups.set(id, lines);
    }
    this.events.set(event.id, state);
    if (this.handlers.onSnapshot)
      this.handlers.onSnapshot(this.getSnapshot(event.id)!);
  }

  // The hot price path touches changed markets only; structural changes rebuild membership.
  update(
    snapshot: BetanoSnapshot,
    diff: BetanoDiff,
    projectedAt = Date.now(),
  ): BetanoTennisChange | null {
    const state = this.events.get(snapshot.event.id);
    if (state && !state.synchronized) return null;
    const eventChange =
      (diff.type < 20 && diff.type !== 16 && diff.type !== 17) ||
      diff.type === 300 ||
      diff.type === 301;
    const event = state && !eventChange ? state.event : tennisEvent(snapshot);
    if (!event) {
      this.remove(snapshot.event.id, snapshot.version, projectedAt);
      return null;
    }
    if (
      !state ||
      state.event.player1.name !== event.player1.name ||
      state.event.player2.name !== event.player2.name ||
      state.event.player1.id !== event.player1.id ||
      state.event.player2.id !== event.player2.id ||
      state.event.phase !== event.phase
    ) {
      this.install(snapshot, projectedAt);
      return null;
    }
    const changed = new Set<number>();
    const payload = diff.payload;
    const structural = [101, 102, 106].includes(diff.type);
    if (structural) {
      for (const id of state.activeMarkets) changed.add(id);
      for (const id of snapshot.event.marketIdList) changed.add(id);
    } else if (diff.type === 100) {
      if (Array.isArray(payload.marketChanges))
        for (const patch of payload.marketChanges)
          if (isRecord(patch) && Number.isSafeInteger(patch.id))
            changed.add(patch.id as number);
      if (isRecord(payload.selectionChanges))
        for (const [key, patches] of Object.entries(payload.selectionChanges)) {
          if (Number.isSafeInteger(Number(key))) changed.add(Number(key));
          if (Array.isArray(patches))
            for (const patch of patches)
              if (isRecord(patch)) {
                const id = state.selectionMarkets.get(patch.id as number);
                if (id !== undefined) changed.add(id);
              }
        }
    } else if (diff.type === 105 && Number.isSafeInteger(payload.id))
      changed.add(payload.id as number);
    else if (diff.type === 150) {
      const id = state.selectionMarkets.get(payload.id as number);
      if (id !== undefined) changed.add(id);
    }
    const active = structural ? new Set(snapshot.event.marketIdList) : null;
    const upserts: BetanoTennisLine[] = [],
      removed: string[] = [];
    for (const id of changed) {
      const previous =
        state.groups.get(id) ?? new Map<string, BetanoTennisLine>();
      const market = (active ? !active.has(id) : !state.activeMarkets.has(id))
        ? undefined
        : snapshot.markets[id];
      this.index(state, id, market);
      const next = market
        ? tennisLines(market, snapshot, event)
        : new Map<string, BetanoTennisLine>();
      for (const key of previous.keys()) if (!next.has(key)) removed.push(key);
      for (const [key, line] of next) {
        const old = previous.get(key);
        if (!old || !sameLine(old, line)) upserts.push(line);
      }
      if (next.size) state.groups.set(id, next);
      else state.groups.delete(id);
    }
    const changedEvent = !sameEvent(state.event, event);
    if (active) state.activeMarkets = active;
    state.event = event;
    state.sourceVersion = snapshot.version;
    state.projectedAt = projectedAt;
    if (!changedEvent && !upserts.length && !removed.length) return null;
    const change: BetanoTennisChange = {
      kind: "update",
      eventId: event.id,
      sourceVersion: snapshot.version,
      projectedAt,
      ...(changedEvent ? { event } : {}),
      upserts,
      removed,
    };
    this.handlers.onUpdate?.(change);
    return change;
  }

  // Cache IDs separately because the raw store mutates market membership in place.
  private index(
    state: BetanoTennisProjectionState,
    id: number,
    market: BetanoMarket | undefined,
  ): void {
    for (const selection of state.marketSelections.get(id) ?? [])
      state.selectionMarkets.delete(selection);
    state.marketSelections.delete(id);
    if (
      !market ||
      !catalogTypes.has(market.typeId ?? -1) ||
      !Array.isArray(market.selectionIdList)
    )
      return;
    const ids = [...market.selectionIdList];
    state.marketSelections.set(id, ids);
    for (const selection of ids) state.selectionMarkets.set(selection, id);
  }

  getSnapshot(
    eventId: number,
    includeStale = false,
  ): BetanoTennisSnapshot | null {
    const state = this.events.get(eventId);
    return state && (state.synchronized || includeStale)
      ? {
          provider: "betano",
          event: state.event,
          sourceVersion: state.sourceVersion,
          projectedAt: state.projectedAt,
          synchronized: state.synchronized,
          lines: [...state.groups.values()].flatMap((lines) => [
            ...lines.values(),
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
  *snapshots(): IterableIterator<BetanoTennisSnapshot> {
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
