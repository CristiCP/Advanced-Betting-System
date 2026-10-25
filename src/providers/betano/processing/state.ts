import type {
  BetanoDiff,
  BetanoEvent,
  BetanoEventState,
  BetanoMarket,
  BetanoRecord,
  BetanoSnapshot,
  BetanoStoreHandlers,
} from "../model/state.interfaces.js";

/**
 * @file Applies ordered odds changes and hides state until version gaps are repaired.
 */

export function isRecord(value: unknown): value is BetanoRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBetanoEvent(value: unknown): value is BetanoEvent {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.id) &&
    ["FOOT", "BASK", "TENN"].includes(String(value.sportId)) &&
    Array.isArray(value.marketIdList)
  );
}

export function isLiveEvent(event: BetanoEvent): boolean {
  return event.isLive === true && event.isEnded !== true;
}

export class BetanoStore {
  readonly events = new Map<number, BetanoEventState>();

  constructor(
    private readonly maxBufferedDiffs: number,
    private readonly handlers: BetanoStoreHandlers,
  ) {}

  // Keep discovery metadata separate from complete event snapshots.
  add(event: BetanoEvent): boolean {
    const current = this.events.get(event.id);
    if (current !== undefined) {
      current.event = event;
      return false;
    }
    this.events.set(event.id, {
      event,
      snapshot: null,
      stale: true,
      pending: new Map(),
      targetVersion: 0,
      loading: false,
    });
    return true;
  }

  remove(id: number): void {
    if (this.events.delete(id)) this.handlers.onRemove(id);
  }

  invalidate(id: number, reason: string, targetVersion = 0): void {
    const state = this.events.get(id);
    if (state === undefined) return;
    state.targetVersion = Math.max(state.targetVersion, targetVersion);
    if (!state.stale) this.handlers.onStale(id, reason);
    state.stale = true;
  }

  // Discard replayed versions and request a snapshot rather than applying a gap.
  receive(diff: BetanoDiff): void {
    const state = this.events.get(diff.eventId);
    if (state === undefined) return;
    if (diff.type === 0) {
      this.invalidate(diff.eventId, "Server reset the event.");
      state.snapshot = null;
      state.pending.clear();
      state.targetVersion = diff.version;
      return;
    }
    if (diff.version <= (state.snapshot?.version ?? 0)) return;
    if (
      diff.type === 5 ||
      (diff.type === 2 &&
        (diff.payload.isEnded === true || diff.payload.isLive === false))
    ) {
      this.remove(diff.eventId);
      return;
    }
    state.targetVersion = Math.max(state.targetVersion, diff.version);
    if (
      !state.stale &&
      state.snapshot !== null &&
      diff.version === state.snapshot.version + 1 &&
      this.patch(state.snapshot, diff)
    ) {
      state.snapshot.version = diff.version;
      this.handlers.onUpdate(diff);
      return;
    }
    if (state.pending.size >= this.maxBufferedDiffs) state.pending.clear();
    state.pending.set(diff.version, diff);
    this.invalidate(
      diff.eventId,
      `Event versions require resynchronization (type ${diff.type}, local ${state.snapshot?.version ?? 0}, received ${diff.version}).`,
      diff.version,
    );
  }

  // Replay only contiguous changes that arrived while this snapshot was in flight.
  install(id: number, snapshot: BetanoSnapshot): boolean {
    const state = this.events.get(id);
    if (state === undefined) return false;
    if (
      !isRecord(snapshot) ||
      !Number.isSafeInteger(snapshot.version) ||
      snapshot.version < 0 ||
      !isBetanoEvent(snapshot.event) ||
      snapshot.event.id !== id ||
      !isRecord(snapshot.markets) ||
      !isRecord(snapshot.selections)
    ) {
      throw new Error(`Invalid Betano snapshot for event ${id}.`);
    }
    if (!isLiveEvent(snapshot.event)) {
      this.remove(id);
      return true;
    }
    if (state.snapshot !== null && snapshot.version < state.snapshot.version)
      return false;
    state.snapshot = snapshot;
    const pending = [...state.pending.values()].sort(
      (a, b) => a.version - b.version,
    );
    for (const diff of pending) {
      if (diff.version <= snapshot.version) {
        state.pending.delete(diff.version);
        continue;
      }
      if (diff.version !== snapshot.version + 1 || !this.patch(snapshot, diff))
        return false;
      snapshot.version = diff.version;
      state.pending.delete(diff.version);
    }
    if (snapshot.version < state.targetVersion) return false;
    state.stale = false;
    this.handlers.onSnapshot(snapshot);
    return true;
  }

  getSnapshot(id: number): BetanoSnapshot | null {
    const state = this.events.get(id);
    return state === undefined || state.stale ? null : state.snapshot;
  }

  // A fresh subscription can reuse a baseline only after all confirmed versions are present.
  confirmVersion(id: number, version: number): boolean {
    const state = this.events.get(id);
    if (state === undefined) return false;
    state.targetVersion = Math.max(state.targetVersion, version);
    return (
      state.snapshot !== null &&
      state.snapshot.version <= version &&
      this.install(id, state.snapshot)
    );
  }

  private patch(snapshot: BetanoSnapshot, diff: BetanoDiff): boolean {
    const payload = diff.payload;
    switch (diff.type) {
      case 100: {
        if (
          payload.marketChanges !== undefined &&
          !Array.isArray(payload.marketChanges)
        )
          return false;
        for (const patch of (payload.marketChanges ?? []) as unknown[]) {
          if (!isRecord(patch) || !snapshot.markets[String(patch.id)])
            return false;
          Object.assign(
            snapshot.markets[String(patch.id)]!,
            { isSuspended: false },
            patch,
          );
        }
        if (
          payload.selectionChanges !== undefined &&
          !isRecord(payload.selectionChanges)
        )
          return false;
        for (const patches of Object.values(
          (payload.selectionChanges ?? {}) as BetanoRecord,
        )) {
          if (!Array.isArray(patches)) return false;
          for (const patch of patches) {
            if (!isRecord(patch) || !snapshot.selections[String(patch.id)])
              return false;
            Object.assign(
              snapshot.selections[String(patch.id)]!,
              { isSuspended: false, price: 0 },
              patch,
            );
          }
        }
        if (payload.totalMarketsAvailable !== undefined)
          snapshot.event.totalMarketsAvailable = payload.totalMarketsAvailable;
        return true;
      }
      case 101: {
        if (payload.markets !== undefined && !Array.isArray(payload.markets))
          return false;
        for (const value of (payload.markets ?? []) as unknown[]) {
          if (
            !isRecord(value) ||
            !Number.isSafeInteger(value.id) ||
            !Array.isArray(value.selections)
          )
            return false;
          const market = {
            ...value,
            selectionIdList: value.selections.map(
              (selection: { id: number }) => selection.id,
            ),
          } as BetanoMarket;
          delete market.selections;
          snapshot.markets[String(market.id)] = market;
          if (!snapshot.event.marketIdList.includes(market.id))
            snapshot.event.marketIdList.push(market.id);
          for (const selection of value.selections)
            snapshot.selections[String(selection.id)] = selection;
        }
        if (isRecord(payload.selections)) {
          for (const [marketId, selections] of Object.entries(
            payload.selections,
          )) {
            if (!Array.isArray(selections) || !snapshot.markets[marketId])
              return false;
            for (const selection of selections) {
              if (!isRecord(selection) || !Number.isSafeInteger(selection.id))
                return false;
              snapshot.selections[String(selection.id)] = selection as {
                id: number;
              };
              const ids = snapshot.markets[marketId]!.selectionIdList;
              if (!ids.includes(selection.id as number))
                ids.push(selection.id as number);
            }
          }
        }
        if (payload.totalMarketsAvailable !== undefined)
          snapshot.event.totalMarketsAvailable = payload.totalMarketsAvailable;
        return true;
      }
      case 102: {
        if (
          payload.marketIds !== undefined &&
          !Array.isArray(payload.marketIds)
        )
          return false;
        for (const id of (payload.marketIds ?? []) as number[]) {
          for (const selection of snapshot.markets[id]?.selectionIdList ?? [])
            delete snapshot.selections[selection];
          delete snapshot.markets[id];
          snapshot.event.marketIdList = snapshot.event.marketIdList.filter(
            (value) => value !== id,
          );
        }
        if (isRecord(payload.selectionIds)) {
          for (const [id, selections] of Object.entries(payload.selectionIds)) {
            if (!Array.isArray(selections)) return false;
            for (const selection of selections)
              delete snapshot.selections[selection];
            const market = snapshot.markets[id];
            if (market)
              market.selectionIdList = market.selectionIdList.filter(
                (value) => !selections.includes(value),
              );
          }
        }
        if (payload.totalMarketsAvailable !== undefined)
          snapshot.event.totalMarketsAvailable = payload.totalMarketsAvailable;
        return true;
      }
      case 105: {
        const market = snapshot.markets[String(payload.id)];
        if (!market) return false;
        Object.assign(market, { isSuspended: false }, payload);
        return true;
      }
      case 106:
        if (Array.isArray(payload.marketIds))
          snapshot.event.marketIdList = payload.marketIds;
        if (isRecord(payload.selectionIds))
          for (const [id, selections] of Object.entries(payload.selectionIds)) {
            if (!Array.isArray(selections) || !snapshot.markets[id])
              return false;
            snapshot.markets[id]!.selectionIdList = selections;
          }
        if (isRecord(payload.liveBalancedMarketIds))
          for (const market of Object.values(snapshot.markets)) {
            const balanced =
              payload.liveBalancedMarketIds[String(market.typeId)];
            if (balanced !== undefined)
              market.isBalanced = String(balanced) === String(market.id);
          }
        return true;
      case 107: {
        const market = snapshot.markets[String(payload.marketId)];
        if (market) market.notes = payload.notes ?? [];
        return true;
      }
      case 108:
      case 109:
      case 111: {
        const field =
          diff.type === 108
            ? "matchComboExclude"
            : diff.type === 109
              ? "hasZeroRake"
              : "ranking";
        const values =
          diff.type === 108 ? payload.marketsToMatchComboMap : payload;
        if (!isRecord(values)) return false;
        for (const [id, value] of Object.entries(values))
          if (snapshot.markets[id]) snapshot.markets[id]![field] = value;
        return true;
      }
      case 110:
      case 151: {
        if (isRecord(payload.selectionChanges))
          for (const [id, value] of Object.entries(payload.selectionChanges)) {
            const selection = snapshot.selections[id];
            if (selection)
              selection[diff.type === 110 ? "renderingLayout" : "columnIndex"] =
                value;
          }
        if (diff.type === 110 && isRecord(payload.marketChanges))
          for (const [id, value] of Object.entries(payload.marketChanges)) {
            if (snapshot.markets[id])
              snapshot.markets[id]!.renderingLayout = value;
          }
        return true;
      }
      case 150: {
        const selection = snapshot.selections[String(payload.id)];
        if (selection) Object.assign(selection, payload);
        return true;
      }
      case 300:
      case 301:
        if (!isRecord(payload.liveData)) return false;
        snapshot.event.liveData = payload.liveData;
        return true;
      case 302:
        if (!Array.isArray(payload.incidents)) return false;
        snapshot.event.incidents = [
          ...(payload.reset === true || !Array.isArray(snapshot.event.incidents)
            ? []
            : snapshot.event.incidents),
          ...payload.incidents,
        ];
        snapshot.event.incidentFilters = payload.filters ?? [];
        return true;
      case 16: {
        const statistics = isRecord(snapshot.event.statistics)
          ? snapshot.event.statistics
          : {};
        for (const key of ["event", "teams", "players"])
          if (isRecord(payload[key])) {
            const current = isRecord(statistics[key]) ? statistics[key] : {};
            for (const [id, value] of Object.entries(payload[key])) {
              if (key === "players" && isRecord(current[id]) && isRecord(value))
                Object.assign(current[id], value);
              else current[id] = value;
            }
            statistics[key] = current;
          }
        snapshot.event.statistics = statistics;
        return true;
      }
      case 17:
        snapshot.event.roster = payload;
        return true;
      case 3:
        snapshot.event.isSuspended = payload.isSuspended === true;
        return true;
      case 6:
        Object.assign(
          snapshot.event,
          { isSuspended: false, willGoLive: false },
          payload,
        );
        return true;
      case 2:
      case 7:
      case 8:
      case 9:
      case 10:
      case 11:
      case 13:
      case 14:
      case 15:
      case 19:
        Object.assign(snapshot.event, payload);
        return true;
      default:
        // Unknown vendor changes are repaired with a full snapshot.
        return false;
    }
  }
}
