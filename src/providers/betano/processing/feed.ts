import { NetworkPortClient } from "../../../network/workers/port-client.js";
import { BetanoFootballProjection } from "./football-projection.js";
import type { BetanoFootballSnapshot } from "../model/football-projection.interfaces.js";
import type {
  NetworkWorkerMessage,
  NetworkStreamMessage,
} from "../../../network/model/worker.interfaces.js";
import { decodeDiffs } from "../protocol/compression.js";
import { SignalRSession } from "../protocol/signalr.js";
import { BetanoHttpError } from "../protocol/http-error.js";
import { BetanoStore, isBetanoEvent, isLiveEvent, isRecord } from "./state.js";
import type {
  BetanoDiff,
  BetanoEvent,
  BetanoRecord,
  BetanoSnapshot,
} from "../model/state.interfaces.js";
import type { BetanoOptions } from "../model/config.interfaces.js";
import type {
  BetanoFeedHandlers,
  BetanoSocketState,
  BetanoStats,
} from "../model/feed.interfaces.js";

/**
 * @file Discovers supported live events and maintains versioned odds on shared sockets.
 */

export class BetanoFeed {
  readonly store: BetanoStore;
  private readonly football: BetanoFootballProjection;
  private readonly sockets = new Map<string, BetanoSocketState>();
  private readonly membership = new Map<number, BetanoSocketState>();
  private readonly revisions = new Map<number, number>();
  private readonly queued = new Set<number>();
  private readonly retries = new Map<number, ReturnType<typeof setTimeout>>();
  private discovering: Promise<void> | null = null;
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private discoveryRetry: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private discoveryDebounce: ReturnType<typeof setTimeout> | null = null;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private cooldownUntil = 0;
  private readonly failures = new Map<number, number>();
  private activeRequests = 0;
  private nextSocket = 1;
  private stopping = false;
  private readonly counters = {
    snapshots: 0,
    snapshotErrors: 0,
    decodedBatches: 0,
    appliedDiffs: 0,
    resynchronizations: 0,
  };

  constructor(
    private readonly network: NetworkPortClient,
    private readonly options: BetanoOptions,
    private readonly handlers: BetanoFeedHandlers,
  ) {
    this.football = new BetanoFootballProjection({
      ...(handlers.onFootballSnapshot
        ? { onSnapshot: handlers.onFootballSnapshot }
        : {}),
      ...(handlers.onFootballUpdate
        ? { onUpdate: handlers.onFootballUpdate }
        : {}),
    });
    this.store = new BetanoStore(options.maxBufferedDiffs, {
      onSnapshot: (snapshot) => {
        this.football.install(snapshot);
        handlers.onSnapshot(snapshot);
      },
      onUpdate: (diff) => {
        this.counters.appliedDiffs++;
        const snapshot = this.store.getSnapshot(diff.eventId);
        if (snapshot) this.football.update(snapshot, diff);
        handlers.onUpdate(diff);
      },
      onStale: (eventId, reason) => {
        this.football.remove(eventId);
        this.counters.resynchronizations++;
        handlers.onStatus({ kind: "event-stale", eventId, reason });
      },
      onRemove: (id) => {
        this.football.remove(id);
        this.detach(id);
      },
    });
  }

  async start(): Promise<void> {
    await this.discover();
    if (this.stopping) return;
    const overview = this.makeSocket("betano:overview");
    await this.openSocket(overview);
    this.discoveryTimer = setInterval(
      () => this.refreshDiscovery(),
      this.options.discoveryIntervalMs,
    );
    this.statsTimer = setInterval(
      () => this.handlers.onStatus({ kind: "stats", stats: this.getStats() }),
      5_000,
    );
  }

  getEvents(): BetanoEvent[] {
    return [...this.store.events.values()].map(
      (state) => state.snapshot?.event ?? state.event,
    );
  }

  getFootballSnapshot(eventId: number): BetanoFootballSnapshot | null {
    return !this.stopping && this.store.getSnapshot(eventId)
      ? this.football.getSnapshot(eventId)
      : null;
  }

  getStats(): BetanoStats {
    return {
      events: this.store.events.size,
      synchronizedEvents: [...this.store.events.values()].filter(
        (state) => !state.stale,
      ).length,
      sockets: this.sockets.size,
      connectedSockets: [...this.sockets.values()].filter(
        (state) => state.session?.ready,
      ).length,
      ...this.counters,
    };
  }

  // Deliberate reconnects use the same snapshot repair path as connection loss.
  async reconnect(): Promise<void> {
    await Promise.all(
      [...this.sockets.values()].map((socket) => this.restartSocket(socket)),
    );
  }

  handle(message: NetworkWorkerMessage): void {
    if (!message.type.startsWith("stream-")) return;
    const stream = message as NetworkStreamMessage;
    const state = this.sockets.get(stream.id);
    try {
      if (this.stopping || state === undefined) return;
      if (stream.type === "stream-open") {
        state.session?.stop();
        state.generation = stream.generation;
        state.attempt = stream.attempt;
        for (const id of state.events) {
          this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
          this.store.invalidate(
            id,
            "WebSocket opened; refreshing the subscribed version.",
          );
        }
        const generation = stream.generation;
        const attempt = stream.attempt;
        const session = new SignalRSession(
          this.options.requestTimeoutMs,
          this.options.heartbeatMs,
          this.options.maxDecodedMessageBytes,
          {
            send: async (data) => {
              await this.network.command({
                type: "send-socket",
                id: state.id,
                generation,
                attempt,
                data,
              });
            },
            onReady: () => {
              this.handlers.onStatus({ kind: "connected", socketId: state.id });
              this.join(state, [...state.events]);
            },
            onInvocation: (target, args) =>
              this.invocation(state, target, args),
            onError: (error) => this.protocolError(state, error),
          },
        );
        state.session = session;
        session.start();
      } else if (
        stream.generation === state.generation &&
        "attempt" in stream &&
        stream.attempt === state.attempt
      ) {
        if (stream.type === "stream-chunk")
          state.session?.receive(stream.chunk);
        if (stream.type === "stream-end" || stream.type === "stream-error") {
          state.session?.stop();
          state.session = null;
          for (const id of state.events)
            this.store.invalidate(id, "WebSocket disconnected.");
          if (stream.type === "stream-error")
            this.handlers.onError(stream.error);
          this.handlers.onStatus({ kind: "disconnected", socketId: state.id });
        }
      }
    } catch (error) {
      if (state !== undefined) this.protocolError(state, error);
    } finally {
      // Acknowledge after decoding, even when a malformed batch triggers repair.
      if (stream.type === "stream-chunk")
        this.network.post({
          type: "ack-stream",
          id: stream.id,
          generation: stream.generation,
          sequence: stream.sequence,
        });
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.football.clear();
    if (this.discoveryTimer !== null) clearInterval(this.discoveryTimer);
    if (this.discoveryRetry !== null) clearTimeout(this.discoveryRetry);
    if (this.statsTimer !== null) clearInterval(this.statsTimer);
    if (this.discoveryDebounce !== null) clearTimeout(this.discoveryDebounce);
    if (this.cooldownTimer !== null) clearTimeout(this.cooldownTimer);
    for (const timer of this.retries.values()) clearTimeout(timer);
    this.retries.clear();
    this.queued.clear();
    for (const state of this.sockets.values()) state.session?.stop();
    const results = await Promise.allSettled(
      [...this.sockets.keys()].map((id) =>
        this.network.command({ type: "stop-socket", id }),
      ),
    );
    this.sockets.clear();
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length)
      throw new AggregateError(errors, "Betano socket shutdown failed.");
  }

  private makeSocket(id: string): BetanoSocketState {
    const state: BetanoSocketState = {
      id,
      events: new Set(),
      generation: 0,
      attempt: 0,
      session: null,
      restarting: null,
    };
    this.sockets.set(id, state);
    return state;
  }

  private async openSocket(state: BetanoSocketState): Promise<void> {
    await this.network.command({
      type: "start-socket",
      id: state.id,
      origin: this.options.origin,
      path: "/contenthub?platformType=1",
      connectTimeoutMs: this.options.requestTimeoutMs,
      idleTimeoutMs: this.options.serverTimeoutMs,
      retryDelayMs: this.options.retryDelayMs,
      maxInFlightBytes: this.options.maxInFlightBytes,
      maxMessageBytes: this.options.maxDecodedMessageBytes,
    });
  }

  private restartSocket(state: BetanoSocketState): Promise<void> {
    if (this.stopping || this.sockets.get(state.id) !== state)
      return Promise.resolve();
    if (state.restarting !== null) return state.restarting;
    state.session?.stop();
    state.session = null;
    for (const id of state.events)
      this.store.invalidate(id, "WebSocket is restarting.");
    state.restarting = (async () => {
      await this.network.command({ type: "stop-socket", id: state.id });
      if (!this.stopping && this.sockets.get(state.id) === state)
        await this.openSocket(state);
    })().finally(() => {
      state.restarting = null;
    });
    return state.restarting;
  }

  private protocolError(state: BetanoSocketState, error: unknown): void {
    if (this.stopping) return;
    this.handlers.onError(
      error instanceof Error ? error.message : String(error),
    );
    void this.restartSocket(state).catch((failure: unknown) =>
      this.handlers.onError(String(failure)),
    );
  }

  private join(state: BetanoSocketState, ids: number[]): void {
    const session = state.session;
    if (session === null || !session.ready || this.stopping) return;
    const overview = state.id === "betano:overview";
    const target = overview
      ? "joinLiveOverviewGroupWithOptions"
      : "joinLiveEventGroup";
    const argument = overview
      ? { language: 4, platformType: 1, includeVirtuals: false }
      : {
          language: 4,
          platformType: 1,
          includeEvent: true,
          IncludeMarkets: true,
          IncludeIncidents: true,
          maxQueueSize: 30,
          eventIds: ids,
        };
    void session
      .invoke(target, argument)
      .then(() => {
        if (this.stopping || state.session !== session) return;
        if (overview) this.refreshDiscovery();
        else for (const id of ids) this.ensureSnapshot(id);
      })
      .catch((error: unknown) => {
        if (state.session === session) this.protocolError(state, error);
      });
  }

  private invocation(
    state: BetanoSocketState,
    target: string,
    args: unknown[],
  ): void {
    if (target === "NewLiveEventDiff" || target === "NewLiveOverviewDiffs") {
      const diffs = decodeDiffs(args[0], this.options.maxDecodedMessageBytes);
      this.counters.decodedBatches++;
      for (const diff of diffs) {
        if (diff.type === 9999) {
          for (const id of this.store.events.keys()) {
            this.store.invalidate(id, "Betano requested a global reset.");
            this.ensureSnapshot(id);
          }
          this.refreshDiscovery();
          continue;
        }
        if (target === "NewLiveOverviewDiffs") this.overviewDiff(diff);
        else if (state.events.has(diff.eventId)) {
          this.store.receive(diff);
          if (this.store.events.get(diff.eventId)?.stale)
            this.ensureSnapshot(diff.eventId);
        }
      }
    } else if (target === "OnActiveLiveEventVersion" && isRecord(args[0])) {
      const id = args[0].eventId;
      const version = args[0].version;
      if (
        typeof id === "number" &&
        typeof version === "number" &&
        state.events.has(id)
      ) {
        const event = this.store.events.get(id);
        if (event && (event.snapshot?.version ?? 0) < version)
          this.store.invalidate(
            id,
            "Subscribed version is newer than the local state.",
            version,
          );
        this.ensureSnapshot(id);
      }
    }
  }

  // Overview pushes discover starts and removals between periodic full reconciliations.
  private overviewDiff(diff: BetanoDiff): void {
    if (
      diff.type === 5 ||
      (diff.type === 2 &&
        (diff.payload.isEnded === true || diff.payload.isLive === false))
    ) {
      this.store.remove(diff.eventId);
    } else if (
      diff.type === 0 ||
      diff.type === 1 ||
      (diff.type === 2 &&
        diff.payload.isLive === true &&
        !this.store.events.has(diff.eventId))
    ) {
      if (
        (diff.sportId === undefined || [1, 2, 3].includes(diff.sportId)) &&
        this.discoveryDebounce === null
      ) {
        this.discoveryDebounce = setTimeout(() => {
          this.discoveryDebounce = null;
          this.refreshDiscovery();
        }, 1_000);
      }
    }
  }

  private refreshDiscovery(): void {
    if (this.stopping) return;
    void this.discover().catch((error: unknown) => {
      if (this.stopping) return;
      this.handlers.onError(`Betano discovery failed: ${String(error)}`);
      if (this.discoveryRetry === null)
        this.discoveryRetry = setTimeout(
          () => {
            this.discoveryRetry = null;
            this.refreshDiscovery();
          },
          Math.max(this.options.retryDelayMs, this.cooldownUntil - Date.now()),
        );
    });
  }

  private discover(): Promise<void> {
    this.discovering ??= this.reconcile().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  private async reconcile(): Promise<void> {
    const snapshot = await this.request(
      "/danae-webapi/api/live/overview/latest?includeVirtuals=false&queryLanguageId=4&queryOperatorId=3",
    );
    if (this.stopping) return;
    if (!isRecord(snapshot.events))
      throw new Error("Betano overview is missing events.");
    const excludedZones = new Set(
      Object.values(isRecord(snapshot.zones) ? snapshot.zones : {})
        .filter(
          (zone) =>
            isRecord(zone) &&
            /^(esoccer|ebasketball|etennis|esports|virtual)/i.test(
              String(zone.code),
            ),
        )
        .map((zone) => (zone as BetanoRecord).id),
    );
    const live = Object.values(snapshot.events)
      .filter(isBetanoEvent)
      .filter(isLiveEvent)
      .filter((event) => !excludedZones.has(event.zoneId));
    const ids = new Set(live.map((event) => event.id));
    for (const id of this.store.events.keys())
      if (!ids.has(id)) this.store.remove(id);
    const created: BetanoSocketState[] = [];
    const additions = new Map<BetanoSocketState, number[]>();
    for (const event of live) {
      if (!this.store.add(event)) continue;
      let socket = [...this.sockets.values()].find(
        (state) =>
          state.id !== "betano:overview" &&
          state.events.size < this.options.eventsPerSocket,
      );
      if (socket === undefined) {
        socket = this.makeSocket(`betano:events:${this.nextSocket++}`);
        created.push(socket);
      }
      socket.events.add(event.id);
      this.membership.set(event.id, socket);
      const list = additions.get(socket) ?? [];
      list.push(event.id);
      additions.set(socket, list);
    }
    await Promise.all(created.map((socket) => this.openSocket(socket)));
    for (const [socket, added] of additions)
      if (!created.includes(socket)) this.join(socket, added);
    this.handlers.onEvents(this.getEvents());
  }

  private detach(id: number): void {
    this.queued.delete(id);
    const retry = this.retries.get(id);
    if (retry !== undefined) clearTimeout(retry);
    this.retries.delete(id);
    this.revisions.delete(id);
    this.failures.delete(id);
    const socket = this.membership.get(id);
    this.membership.delete(id);
    if (socket !== undefined) {
      socket.events.delete(id);
      if (socket.events.size === 0) {
        socket.session?.stop();
        socket.session = null;
        this.sockets.delete(socket.id);
        void this.network
          .command({ type: "stop-socket", id: socket.id })
          .catch((error: unknown) => {
            if (!this.stopping) this.handlers.onError(String(error));
          });
      } else if (socket.session?.ready) {
        const session = socket.session;
        void session
          .invoke("leaveLiveEventGroup", {
            language: 4,
            platformType: 1,
            eventIds: [id],
          })
          .catch((error: unknown) => {
            if (socket.session === session) this.protocolError(socket, error);
          });
      }
    }
    this.handlers.onRemove(id);
  }

  private ensureSnapshot(id: number): void {
    const state = this.store.events.get(id);
    if (
      this.stopping ||
      !state?.stale ||
      state.loading ||
      this.retries.has(id) ||
      !this.membership.get(id)?.session?.ready
    )
      return;
    this.queued.add(id);
    this.drain();
  }

  private drain(): void {
    if (this.stopping) return;
    if (Date.now() < this.cooldownUntil) {
      if (this.cooldownTimer === null)
        this.cooldownTimer = setTimeout(() => {
          this.cooldownTimer = null;
          this.drain();
        }, this.cooldownUntil - Date.now());
      return;
    }
    while (
      !this.stopping &&
      this.activeRequests < this.options.maxConcurrentSnapshots &&
      this.queued.size
    ) {
      const id = this.queued.values().next().value!;
      this.queued.delete(id);
      const state = this.store.events.get(id);
      if (state === undefined || state.loading || !state.stale) continue;
      state.loading = true;
      this.activeRequests++;
      const revision = this.revisions.get(id);
      void this.request(`/danae-webapi/api/live/events/${id}/latest`)
        .then((snapshot) => {
          if (
            this.stopping ||
            this.store.events.get(id) !== state ||
            this.revisions.get(id) !== revision
          )
            return;
          this.counters.snapshots++;
          if (snapshot.result !== undefined && !snapshot.event)
            throw new Error(`Betano event ${id} is temporarily unavailable.`);
          this.store.install(id, snapshot as BetanoSnapshot);
          this.failures.delete(id);
        })
        .catch((error: unknown) => {
          if (!this.stopping && this.store.events.get(id) === state) {
            this.counters.snapshotErrors++;
            this.failures.set(id, (this.failures.get(id) ?? 0) + 1);
            this.handlers.onError(String(error), id);
          }
        })
        .finally(() => {
          state.loading = false;
          this.activeRequests--;
          if (
            !this.stopping &&
            this.store.events.get(id) === state &&
            state.stale &&
            !this.retries.has(id)
          ) {
            const backoff = Math.min(
              30_000,
              this.options.retryDelayMs *
                2 ** Math.min(5, this.failures.get(id) ?? 0),
            );
            this.retries.set(
              id,
              setTimeout(
                () => {
                  this.retries.delete(id);
                  this.ensureSnapshot(id);
                },
                Math.max(backoff, this.cooldownUntil - Date.now()),
              ),
            );
          }
          this.drain();
        });
    }
  }

  private async request(path: string): Promise<BetanoRecord> {
    if (Date.now() < this.cooldownUntil)
      throw new BetanoHttpError(429, this.cooldownUntil - Date.now());
    const message = await this.network.command({
      type: "request",
      origin: this.options.origin,
      request: {
        path,
        method: "GET",
        headers: {
          "x-language": "4",
          "x-operator": "3",
          accept: "application/json",
        },
      },
    });
    if (message.type !== "request-response")
      throw new Error("Invalid network response.");
    if (message.response.statusCode !== 200) {
      const status = message.response.statusCode;
      let retryAfterMs = this.options.retryDelayMs;
      if (status === 429 || status === 503) {
        const header = message.response.headers["retry-after"];
        const retryAfter = Array.isArray(header) ? header[0] : header;
        const seconds = Number(retryAfter);
        retryAfterMs =
          retryAfter && Number.isFinite(seconds)
            ? seconds * 1_000
            : retryAfter
              ? Date.parse(retryAfter) - Date.now()
              : 30_000;
        if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0)
          retryAfterMs = 30_000;
        retryAfterMs = Math.min(2_147_483_647, retryAfterMs);
        this.cooldownUntil = Math.max(
          this.cooldownUntil,
          Date.now() + retryAfterMs,
        );
      }
      throw new BetanoHttpError(status, retryAfterMs);
    }
    const value: unknown = JSON.parse(
      Buffer.from(message.response.body).toString("utf8"),
    );
    if (!isRecord(value)) throw new Error("Invalid Betano JSON response.");
    return value;
  }
}
