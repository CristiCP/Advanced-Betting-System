import type { AggregationEvent } from "../model/matching.interfaces.js";
import type {
  AggregationEventIdentity,
  AggregationProvider,
} from "../model/wire.interfaces.js";
import { normalizeTeam } from "../matching/names.js";
import { liveFlags } from "../protocol/wire.js";
import type { AggregationSport } from "../model/tennis.interfaces.js";
import { normalizeTennisParticipant } from "../matching/tennis-names.js";

/**
 * @file Keeps one provider's events by wire handle, with names normalized once per identity change.
 */

export class EventRegistry {
  private readonly events: (AggregationEvent | undefined)[];
  private count = 0;

  constructor(
    readonly provider: AggregationProvider,
    maxEvents: number,
    private readonly sport: AggregationSport = "football",
  ) {
    this.events = new Array<AggregationEvent | undefined>(maxEvents);
  }

  get size(): number {
    return this.count;
  }

  get(handle: number): AggregationEvent | undefined {
    return this.events[handle];
  }

  *all(): IterableIterator<AggregationEvent> {
    for (const event of this.events) if (event !== undefined) yield event;
  }

  // Returns the previous identity, or null when the handle was free.
  identify(
    handle: number,
    identity: AggregationEventIdentity,
  ): { event: AggregationEvent; previous: AggregationEventIdentity | null } {
    const event = this.events[handle];
    if (event !== undefined) {
      const previous = event.identity;
      event.identity = identity;
      if (previous.home !== identity.home)
        event.home = this.normalize(identity.home);
      if (previous.away !== identity.away)
        event.away = this.normalize(identity.away);
      return { event, previous };
    }
    const created: AggregationEvent = {
      provider: this.provider,
      handle,
      identity,
      home: this.normalize(identity.home),
      away: this.normalize(identity.away),
      synchronized: false,
      live: false,
      suspended: true,
      scoreKnown: false,
      homeScore: 0,
      awayScore: 0,
      clockKnown: false,
      clockRunning: false,
      clockSeconds: 0,
      clockAt: NaN,
      scoreChangedAt: NaN,
      lines: new Map(),
      pair: null,
      conflict: false,
    };
    this.events[handle] = created;
    this.count++;
    return { event: created, previous: null };
  }

  // Returns true when the score or its availability changed.
  live(
    event: AggregationEvent,
    flags: number,
    homeScore: number,
    awayScore: number,
    clockSeconds: number,
    now: number,
  ): boolean {
    const scoreKnown = (flags & liveFlags.score) !== 0;
    const scoreChanged =
      scoreKnown !== event.scoreKnown ||
      homeScore !== event.homeScore ||
      awayScore !== event.awayScore;
    const wasSynchronized = event.synchronized;
    event.synchronized = (flags & liveFlags.stale) === 0;
    event.live = (flags & liveFlags.live) !== 0;
    event.suspended = (flags & liveFlags.suspended) !== 0;
    event.scoreKnown = scoreKnown;
    event.homeScore = homeScore;
    event.awayScore = awayScore;
    const clockKnown = (flags & liveFlags.clock) !== 0;
    const clockRunning = (flags & liveFlags.running) !== 0;
    if (
      (!wasSynchronized && event.synchronized) ||
      clockKnown !== event.clockKnown ||
      clockRunning !== event.clockRunning ||
      clockSeconds !== event.clockSeconds
    )
      event.clockAt = now;
    event.clockKnown = clockKnown;
    event.clockRunning = clockRunning;
    event.clockSeconds = clockSeconds;
    if (scoreChanged) event.scoreChangedAt = now;
    return scoreChanged;
  }

  release(handle: number): AggregationEvent | undefined {
    const event = this.events[handle];
    if (event === undefined) return undefined;
    this.events[handle] = undefined;
    this.count--;
    return event;
  }

  clear(): void {
    this.events.fill(undefined);
    this.count = 0;
  }

  private normalize(name: string) {
    return this.sport === "tennis"
      ? normalizeTennisParticipant(name)
      : normalizeTeam(name);
  }
}
