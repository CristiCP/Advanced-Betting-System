import type {
  SuperbetEvent,
  SuperbetEventState,
  SuperbetMarket,
  SuperbetRecord,
  SuperbetSnapshot,
  SuperbetStoreHandlers,
  SuperbetUpdate,
} from "../model/state.interfaces.js";

/**
 * @file Maintains complete Superbet markets and rejects stale or incomplete versions.
 */

export function isRecord(value: unknown): value is SuperbetRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUpdate(value: unknown): value is SuperbetUpdate {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.event_id) &&
    Number(value.event_id) > 0 &&
    Number.isSafeInteger(value.increment_id) &&
    Number(value.increment_id) >= 0
  );
}

export function isLive(update: SuperbetUpdate): boolean {
  return (
    isRecord(update.fixture) &&
    [5, 4, 2].includes(update.fixture.sport_id) &&
    typeof update.fixture.event_name === "string" &&
    update.fixture.is_outright_event !== true &&
    update.inplay_stats_metadata?.status === "STARTED" &&
    !isEnded(update)
  );
}

export function isEnded(update: SuperbetUpdate): boolean {
  return (
    ["ENDED", "FINISHED", "CANCELLED", "POSTPONED"].includes(
      String(update.inplay_stats_metadata?.status),
    ) || update.fixture?.offer_state_status?.["2"] === 2
  );
}

// Superbet omits the full-market flag when the event explicitly has zero live odds.
function hasNoOdds(update: SuperbetUpdate): boolean {
  const counts = update.inplay_stats_metadata?.counts;
  return (
    isRecord(counts) &&
    isRecord(counts.markets) &&
    isRecord(counts.odds) &&
    counts.markets["2"] === 0 &&
    counts.odds["2"] === 0 &&
    [update.markets, update.superbets, update.priceboosts].every(
      (value) =>
        value === undefined || (Array.isArray(value) && value.length === 0),
    )
  );
}

export function eventFrom(update: SuperbetUpdate): SuperbetEvent {
  if (!isLive(update))
    throw new Error("Expected a supported live Superbet event.");
  return {
    id: update.event_id,
    sportId: update.fixture!.sport_id,
    name: update.fixture!.event_name,
    version: update.increment_id,
  };
}

// Validate market containers before they become visible to callers.
function markets(value: unknown): SuperbetMarket[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Invalid Superbet markets.");
  for (const market of value) {
    if (
      !isRecord(market) ||
      !Number.isSafeInteger(market.id) ||
      typeof market.name !== "string" ||
      !Array.isArray(market.odds)
    )
      throw new Error("Invalid Superbet market.");
    for (const odd of market.odds) {
      if (
        !isRecord(odd) ||
        typeof odd.uuid !== "string" ||
        (odd.price !== undefined &&
          (typeof odd.price !== "number" ||
            !Number.isFinite(odd.price) ||
            odd.price < 0))
      )
        throw new Error("Invalid Superbet selection.");
    }
  }
  return value as SuperbetMarket[];
}

// Market identity includes the vendor name because IDs can describe multiple groups.
function key(market: SuperbetMarket): string {
  return `${market.id}:${market.name}`;
}

function patchMarkets(
  current: SuperbetMarket[],
  changes: SuperbetMarket[],
): SuperbetMarket[] {
  if (changes.length === 0) return current;
  const index = new Map(current.map((market) => [key(market), market]));
  for (const change of changes) {
    const previous = index.get(key(change));
    if (previous === undefined) {
      if (change.odds.every((odd) => odd.display === false)) continue;
      throw new Error("Unknown Superbet market requires a full snapshot.");
    }
    const odds = new Map(previous.odds.map((odd) => [odd.uuid, odd]));
    for (const odd of change.odds) {
      if (odd.display === false) odds.delete(odd.uuid);
      else {
        const old = odds.get(odd.uuid);
        if (old === undefined)
          throw new Error(
            "Unknown Superbet selection requires a full snapshot.",
          );
        odds.set(odd.uuid, { ...old, ...odd });
      }
    }
    if (odds.size === 0) index.delete(key(change));
    else
      index.set(key(change), {
        ...previous,
        ...change,
        odds: [...odds.values()],
      });
  }
  return [...index.values()];
}

export class SuperbetStore {
  readonly events = new Map<number, SuperbetEventState>();

  constructor(
    private readonly maxBuffered: number,
    private readonly handlers: SuperbetStoreHandlers,
  ) {}

  add(update: SuperbetUpdate): boolean {
    const event = eventFrom(update);
    const current = this.events.get(event.id);
    if (current) {
      current.event = event;
      current.minimumVersion = Math.max(current.minimumVersion, event.version);
      if ((current.snapshot?.increment_id ?? -1) < event.version)
        this.invalidate(
          event.id,
          "REST discovery is newer than the local version.",
        );
      return false;
    }
    this.events.set(event.id, {
      event,
      minimumVersion: event.version,
      snapshot: null,
      stale: true,
      pending: new Map(),
    });
    return true;
  }

  getSnapshot(id: number): SuperbetSnapshot | null {
    const state = this.events.get(id);
    return state && !state.stale ? state.snapshot : null;
  }

  invalidate(id: number, reason: string, reset = false): void {
    const state = this.events.get(id);
    if (!state) return;
    if (!state.stale) this.handlers.onStale(id, reason);
    state.stale = true;
    if (reset) {
      state.minimumVersion = Math.max(
        state.minimumVersion,
        state.snapshot?.increment_id ?? 0,
      );
      state.snapshot = null;
      state.pending.clear();
    }
  }

  remove(id: number): void {
    if (this.events.delete(id)) this.handlers.onRemove(id);
  }

  // A full REST response can replace a cached SSE baseline, then replay newer pushes.
  install(update: SuperbetUpdate): void {
    const state = this.events.get(update.event_id);
    if (!state) return;
    if (isEnded(update)) {
      this.remove(update.event_id);
      return;
    }
    if (
      !isLive(update) ||
      (update.is_full_market_update !== true && !hasNoOdds(update))
    )
      throw new Error("Superbet snapshot is incomplete.");
    if (state.snapshot && update.increment_id < state.snapshot.increment_id)
      return;
    state.snapshot = {
      ...update,
      fixture: update.fixture!,
      markets: markets(update.markets),
      superbets: markets(update.superbets),
      priceboosts: markets(update.priceboosts),
    };
    for (const version of state.pending.keys())
      if (version <= update.increment_id) state.pending.delete(version);
    this.replay(state);
    this.publish(state);
  }

  receive(update: SuperbetUpdate): void {
    const state = this.events.get(update.event_id);
    if (!state) return;
    const version = state.snapshot?.increment_id ?? -1;
    if (update.increment_id <= version) return;
    if (isEnded(update)) {
      this.remove(update.event_id);
      return;
    }
    if (
      state.snapshot === null &&
      isLive(update) &&
      (update.is_full_market_update === true || hasNoOdds(update))
    ) {
      this.install(update);
      return;
    }
    if (state.snapshot && update.increment_id === version + 1) {
      const wasStale = state.stale;
      try {
        this.apply(state, update);
        this.replay(state);
        if (wasStale) this.publish(state);
        else if (!state.stale) this.handlers.onUpdate(update);
      } catch (error) {
        this.invalidate(update.event_id, String(error));
        this.buffer(state, update);
      }
    } else {
      this.invalidate(
        update.event_id,
        "Superbet version gap or missing baseline.",
      );
      this.buffer(state, update);
    }
  }

  private buffer(state: SuperbetEventState, update: SuperbetUpdate): void {
    state.minimumVersion = Math.max(state.minimumVersion, update.increment_id);
    if (state.pending.size >= this.maxBuffered) state.pending.clear();
    state.pending.set(update.increment_id, update);
  }

  private replay(state: SuperbetEventState): void {
    while (state.snapshot) {
      const next = state.pending.get(state.snapshot.increment_id + 1);
      if (!next) break;
      this.apply(state, next);
      state.pending.delete(next.increment_id);
    }
  }

  private publish(state: SuperbetEventState): void {
    const snapshot = state.snapshot;
    if (
      !snapshot ||
      snapshot.increment_id < state.minimumVersion ||
      state.pending.size > 0
    )
      return;
    state.stale = false;
    this.handlers.onSnapshot(snapshot);
  }

  private apply(state: SuperbetEventState, update: SuperbetUpdate): void {
    const old = state.snapshot!;
    const next = { ...old, ...update, fixture: update.fixture ?? old.fixture };
    next.markets = update.is_full_market_update
      ? markets(update.markets)
      : patchMarkets(old.markets, markets(update.markets));
    next.superbets = update.is_full_superbets_update
      ? markets(update.superbets)
      : patchMarkets(old.superbets, markets(update.superbets));
    next.priceboosts = update.is_full_priceboosts_update
      ? markets(update.priceboosts)
      : patchMarkets(old.priceboosts, markets(update.priceboosts));
    if (hasNoOdds(update)) {
      next.markets = [];
      next.superbets = [];
      next.priceboosts = [];
    }
    state.snapshot = next;
    state.pending.delete(update.increment_id);
  }
}
