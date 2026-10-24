import { betanoFootballMarkets } from "../football-markets.config.js";
import type {
  BetanoDiff,
  BetanoMarket,
  BetanoSnapshot,
} from "../model/state.interfaces.js";
import type {
  BetanoFootballChange,
  BetanoFootballEvent,
  BetanoFootballLine,
  BetanoFootballProjectionHandlers,
  BetanoFootballProjectionState,
  BetanoFootballSnapshot,
} from "../model/football-projection.interfaces.js";
import { footballEvent, footballLines } from "./football-markets.js";
import { isRecord } from "./state.js";

/**
 * @file Maintains filtered football state after ordered vendor patches and emits changed lines.
 */

const catalogTypes = new Set<number>(
  betanoFootballMarkets.map((m) => m.typeId),
);

function sameEvent(a: BetanoFootballEvent, b: BetanoFootballEvent): boolean {
  return (Object.keys(a) as (keyof BetanoFootballEvent)[]).every((key) =>
    key === "home" || key === "away"
      ? a[key].id === b[key].id && a[key].name === b[key].name
      : a[key] === b[key],
  );
}

function sameLine(a: BetanoFootballLine, b: BetanoFootballLine): boolean {
  return (
    a.marketTypeId === b.marketTypeId &&
    a.total === b.total &&
    a.handicap === b.handicap &&
    a.isSuspended === b.isSuspended &&
    a.interval?.fromSecond === b.interval?.fromSecond &&
    a.interval?.toSecond === b.interval?.toSecond &&
    a.interval?.endsAtPeriodBoundary === b.interval?.endsAtPeriodBoundary &&
    a.scoreContext?.home === b.scoreContext?.home &&
    a.scoreContext?.away === b.scoreContext?.away &&
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

export class BetanoFootballProjection {
  private readonly events = new Map<number, BetanoFootballProjectionState>();

  constructor(
    private readonly handlers: BetanoFootballProjectionHandlers = {},
  ) {}

  install(snapshot: BetanoSnapshot, projectedAt = Date.now()): void {
    const event = footballEvent(snapshot);
    if (!event) {
      this.remove(snapshot.event.id, snapshot.version, projectedAt);
      return;
    }
    const state: BetanoFootballProjectionState = {
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
      const lines = footballLines(market, snapshot, event);
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
  ): BetanoFootballChange | null {
    const state = this.events.get(snapshot.event.id);
    const eventChange =
      (diff.type < 20 && diff.type !== 16 && diff.type !== 17) ||
      diff.type === 300 ||
      diff.type === 301;
    const event = state && !eventChange ? state.event : footballEvent(snapshot);
    if (!event) {
      this.remove(snapshot.event.id, snapshot.version, projectedAt);
      return null;
    }
    if (
      !state ||
      state.event.home.name !== event.home.name ||
      state.event.away.name !== event.away.name ||
      state.event.home.id !== event.home.id ||
      state.event.away.id !== event.away.id ||
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
    const upserts: BetanoFootballLine[] = [],
      removed: string[] = [];
    for (const id of changed) {
      const previous =
        state.groups.get(id) ?? new Map<string, BetanoFootballLine>();
      const market = (active ? !active.has(id) : !state.activeMarkets.has(id))
        ? undefined
        : snapshot.markets[id];
      this.index(state, id, market);
      const next = market
        ? footballLines(market, snapshot, event)
        : new Map<string, BetanoFootballLine>();
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
    const change: BetanoFootballChange = {
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
    state: BetanoFootballProjectionState,
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

  getSnapshot(eventId: number): BetanoFootballSnapshot | null {
    const state = this.events.get(eventId);
    return state
      ? {
          provider: "betano",
          event: state.event,
          sourceVersion: state.sourceVersion,
          projectedAt: state.projectedAt,
          lines: [...state.groups.values()].flatMap((lines) => [
            ...lines.values(),
          ]),
        }
      : null;
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
