import { NetworkPortClient } from "../../../network/workers/port-client.js";
import type {
  NetworkStreamMessage,
  NetworkWorkerMessage,
} from "../../../network/model/worker.interfaces.js";
import type { SuperbetOptions } from "../model/config.interfaces.js";
import type { SuperbetFootballSnapshot } from "../model/football-projection.interfaces.js";
import type { SuperbetTennisSnapshot } from "../model/tennis-projection.interfaces.js";
import type {
  SuperbetFeedHandlers,
  SuperbetStats,
  SuperbetSubscriptionState,
} from "../model/feed.interfaces.js";
import type {
  SuperbetEvent,
  SuperbetSnapshot,
  SuperbetUpdate,
} from "../model/state.interfaces.js";
import { SuperbetStore, isRecord, isUpdate, isLive } from "./state.js";
import { SuperbetSseDecoder, decodeJson } from "../protocol/sse.js";
import { SuperbetHttpError } from "../protocol/http-error.js";
import { SuperbetFootballProjection } from "./football-projection.js";
import { SuperbetTennisProjection } from "./tennis-projection.js";

/**
 * @file Discovers Superbet live events and synchronizes one independent SSE per match.
 */

export class SuperbetFeed {
  readonly store: SuperbetStore;
  private readonly football: SuperbetFootballProjection;
  private readonly tennis: SuperbetTennisProjection;
  private readonly subscriptions = new Map<number, SuperbetSubscriptionState>();
  private readonly queued = new Set<number>();
  private readonly loading = new Set<number>();
  private readonly operations = new Set<Promise<unknown>>();
  private readonly retries = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly failures = new Map<number, number>();
  private discovery: Promise<void> | null = null;
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private discoveryRetry: ReturnType<typeof setTimeout> | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private cooldownUntil = 0;
  private stopping = false;
  private readonly counters = {
    streamOpens: 0,
    reconnects: 0,
    streamErrors: 0,
    decodedBatches: 0,
    appliedUpdates: 0,
    snapshots: 0,
    snapshotRepairs: 0,
    snapshotErrors: 0,
    decodeErrors: 0,
  };

  constructor(
    private readonly network: NetworkPortClient,
    private readonly options: SuperbetOptions,
    private readonly handlers: SuperbetFeedHandlers,
  ) {
    this.football = new SuperbetFootballProjection({
      ...(handlers.onFootballSnapshot
        ? { onSnapshot: handlers.onFootballSnapshot }
        : {}),
      ...(handlers.onFootballUpdate
        ? { onUpdate: handlers.onFootballUpdate }
        : {}),
    });
    this.tennis = new SuperbetTennisProjection({
      ...(handlers.onTennisSnapshot
        ? { onSnapshot: handlers.onTennisSnapshot }
        : {}),
      ...(handlers.onTennisUpdate ? { onUpdate: handlers.onTennisUpdate } : {}),
    });
    this.store = new SuperbetStore(options.maxBufferedUpdates, {
      onSnapshot: (snapshot) => {
        this.counters.snapshots++;
        this.clearSynchronizationTimer(snapshot.event_id);
        this.football.install(snapshot);
        this.tennis.install(snapshot);
        handlers.onSnapshot(snapshot);
      },
      onUpdate: (update) => {
        this.counters.appliedUpdates++;
        const snapshot = this.store.getSnapshot(update.event_id);
        if (snapshot) {
          this.football.update(snapshot, update);
          this.tennis.update(snapshot, update);
        }
        handlers.onUpdate(update);
      },
      onStale: (eventId, reason) => {
        this.football.invalidate(eventId);
        this.tennis.invalidate(eventId);
        handlers.onStatus({ kind: "event-stale", eventId, reason });
      },
      onRemove: (id) => {
        this.football.remove(id);
        this.tennis.remove(id);
        this.detach(id);
      },
    });
  }

  async start(): Promise<void> {
    await this.discover();
    if (this.stopping) return;
    this.discoveryTimer = setInterval(
      () => this.refreshDiscovery(),
      this.options.discoveryIntervalMs,
    );
    this.maintenanceTimer = setInterval(() => {
      for (const state of this.subscriptions.values()) {
        if (
          state.connected &&
          Date.now() - state.lastActivity >= this.options.streamIdleTimeoutMs
        )
          this.repairStream(state, new Error("Superbet SSE idle timeout."));
      }
      this.handlers.onStatus({ kind: "stats", stats: this.getStats() });
    }, 5_000);
  }

  getEvents(): SuperbetEvent[] {
    return [...this.store.events.values()].map((state) => ({
      ...state.event,
      version: state.snapshot?.increment_id ?? state.event.version,
      name: state.snapshot?.fixture.event_name ?? state.event.name,
    }));
  }

  getSnapshot(id: number): SuperbetSnapshot | null {
    return this.subscriptions.get(id)?.connected
      ? this.store.getSnapshot(id)
      : null;
  }

  getFootballSnapshot(id: number): SuperbetFootballSnapshot | null {
    return this.getSnapshot(id) ? this.football.getSnapshot(id) : null;
  }

  // Replay retained identities without exposing stale snapshots to public queries.
  getTennisSnapshots(): Iterable<SuperbetTennisSnapshot> {
    return this.tennis.snapshots();
  }

  // Replay retained football identities with their synchronization flag.
  getFootballSnapshots(): Iterable<SuperbetFootballSnapshot> {
    return this.football.snapshots();
  }

  getTennisSnapshot(id: number): SuperbetTennisSnapshot | null {
    return this.getSnapshot(id) ? this.tennis.getSnapshot(id) : null;
  }

  getStats(): SuperbetStats {
    return {
      events: this.store.events.size,
      synchronizedEvents: [...this.subscriptions.keys()].filter(
        (id) => this.getSnapshot(id) !== null,
      ).length,
      subscriptions: this.subscriptions.size,
      connectedSubscriptions: [...this.subscriptions.values()].filter(
        (state) => state.connected,
      ).length,
      ...this.counters,
    };
  }

  async reconnect(): Promise<void> {
    await Promise.all(
      [...this.subscriptions.values()].map((state) => this.restart(state)),
    );
  }

  // Each event has its own processing queue; other matches never await its decoder.
  handle(message: NetworkWorkerMessage): void {
    if (!message.type.startsWith("stream-")) return;
    const stream = message as NetworkStreamMessage;
    const id = Number(stream.id.replace(/^superbet:event:/, ""));
    const state = this.subscriptions.get(id);
    if (this.stopping || !state || !state.accepting || state.id !== stream.id) {
      this.ack(stream);
      return;
    }
    const epoch = state.epoch;
    state.queue = state.queue.then(async () => {
      try {
        if (
          this.stopping ||
          this.subscriptions.get(id) !== state ||
          state.epoch !== epoch
        )
          return;
        await this.process(state, stream);
      } catch (error) {
        if (!this.stopping && this.subscriptions.get(id) === state) {
          this.counters.decodeErrors++;
          this.repairStream(state, error);
        }
      } finally {
        this.ack(stream);
      }
    });
  }

  private ack(stream: NetworkStreamMessage): void {
    if (stream.type === "stream-chunk")
      this.network.post({
        type: "ack-stream",
        id: stream.id,
        generation: stream.generation,
        sequence: stream.sequence,
      });
  }

  private async process(
    state: SuperbetSubscriptionState,
    message: NetworkStreamMessage,
  ): Promise<void> {
    if (message.type === "stream-open") {
      state.decoder?.close();
      this.clearSynchronizationTimer(state.eventId);
      state.generation = message.generation;
      state.attempt = message.attempt;
      state.revision++;
      state.connected = true;
      state.lastActivity = Date.now();
      this.counters.streamOpens++;
      if (state.opens++ > 0) this.counters.reconnects++;
      this.store.invalidate(
        state.eventId,
        "SSE reopened; refreshing the complete event.",
        true,
      );
      const encoding = message.response.headers["content-encoding"];
      if (Array.isArray(encoding))
        throw new Error("Invalid Superbet SSE encoding header.");
      state.decoder = new SuperbetSseDecoder(
        encoding,
        this.options.maxDecodedMessageBytes,
        {
          onData: (data) => this.receive(state, data),
        },
      );
      state.synchronizationTimer = setTimeout(() => {
        state.synchronizationTimer = null;
        this.ensureSnapshot(state.eventId);
      }, this.options.synchronizationTimeoutMs);
      this.handlers.onStatus({ kind: "connected", eventId: state.eventId });
      return;
    }
    if (
      message.type === "stream-error" &&
      (state.generation === 0 || message.generation === state.generation)
    ) {
      this.counters.streamErrors++;
      this.handlers.onError(message.error, state.eventId);
    }
    // HTTP 204 can permanently stop a subscription before any stream-open message.
    if (
      message.type === "stream-stopped" &&
      (state.generation === 0 || message.generation === state.generation)
    ) {
      this.disconnect(state, "Superbet server stopped the SSE subscription.");
      this.store.remove(state.eventId);
      return;
    }
    if (
      message.generation !== state.generation ||
      ("attempt" in message && message.attempt !== state.attempt)
    )
      return;
    if (message.type === "stream-chunk") {
      state.lastActivity = Date.now();
      await state.decoder?.write(message.chunk);
    } else if (
      message.type === "stream-end" ||
      message.type === "stream-error"
    ) {
      const decoder = state.decoder;
      state.decoder = null;
      try {
        if (message.type === "stream-end" && !message.cancelled)
          await decoder?.end();
      } finally {
        decoder?.close();
        this.disconnect(state, "Superbet SSE disconnected.");
      }
    }
  }

  private receive(state: SuperbetSubscriptionState, text: string): void {
    const data: unknown = JSON.parse(text);
    const updates = Array.isArray(data) ? data : [data];
    this.counters.decodedBatches++;
    for (const update of updates) {
      if (!isUpdate(update) || update.event_id !== state.eventId)
        throw new Error("Unexpected Superbet SSE event identity or version.");
      this.store.receive(update);
      // Missing increments require REST repair; an old initial baseline gets a grace period.
      if (this.store.events.get(state.eventId)?.pending.size)
        this.ensureSnapshot(state.eventId);
    }
  }

  private disconnect(state: SuperbetSubscriptionState, reason: string): void {
    const wasConnected = state.connected;
    state.connected = false;
    state.revision++;
    this.clearSynchronizationTimer(state.eventId);
    this.store.invalidate(state.eventId, reason, true);
    if (wasConnected)
      this.handlers.onStatus({
        kind: "disconnected",
        eventId: state.eventId,
        reason,
      });
  }

  private clearSynchronizationTimer(id: number): void {
    const state = this.subscriptions.get(id);
    if (state?.synchronizationTimer) clearTimeout(state.synchronizationTimer);
    if (state) state.synchronizationTimer = null;
  }

  private open(state: SuperbetSubscriptionState): Promise<unknown> {
    return this.network.command({
      type: "start-subscription",
      id: state.id,
      origin: this.options.origin,
      request: {
        path: `/v3/subscription/ro-RO/events?events=${state.eventId}`,
        headers: { "accept-encoding": "gzip" },
      },
      headersTimeoutMs: this.options.requestTimeoutMs,
      retryDelayMs: this.options.retryDelayMs,
      maxInFlightBytes: this.options.maxInFlightBytes,
    });
  }

  private restart(state: SuperbetSubscriptionState): Promise<void> {
    if (this.stopping || this.subscriptions.get(state.eventId) !== state)
      return Promise.resolve();
    if (state.restarting) return state.restarting;
    state.epoch++;
    state.accepting = false;
    this.disconnect(state, "Superbet SSE is restarting.");
    state.decoder?.close();
    state.decoder = null;
    state.restarting = (async () => {
      await this.network.command({ type: "stop-subscription", id: state.id });
      if (this.stopping || this.subscriptions.get(state.eventId) !== state)
        return;
      state.generation = 0;
      state.attempt = 0;
      state.accepting = true;
      await this.open(state);
    })()
      .catch((error: unknown) => {
        if (!this.stopping && this.subscriptions.get(state.eventId) === state) {
          this.store.remove(state.eventId);
          this.refreshDiscovery();
        }
        throw error;
      })
      .finally(() => {
        state.restarting = null;
      });
    this.track(state.restarting);
    return state.restarting;
  }

  private repairStream(state: SuperbetSubscriptionState, error: unknown): void {
    if (
      this.stopping ||
      this.subscriptions.get(state.eventId) !== state ||
      state.restarting
    )
      return;
    this.handlers.onError(String(error), state.eventId);
    void this.restart(state).catch((failure: unknown) => {
      if (!this.stopping) {
        this.handlers.onError(String(failure), state.eventId);
        this.refreshDiscovery();
      }
    });
  }

  private discover(): Promise<void> {
    this.discovery ??= this.reconcile().finally(() => {
      this.discovery = null;
    });
    return this.discovery;
  }

  private async reconcile(): Promise<void> {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 7);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date();
    end.setUTCDate(end.getUTCDate() + 1);
    end.setUTCHours(0, 0, 0, 0);
    const query = new URLSearchParams({
      index: "active-live",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });
    const updates = await this.request(`/v3/ro-RO/events?${query}`);
    if (this.stopping) return;
    const live = updates.filter(isLive);
    const ids = new Set(live.map((event) => event.event_id));
    for (const id of this.store.events.keys())
      if (!ids.has(id)) this.store.remove(id);
    const starts: Promise<unknown>[] = [];
    for (const update of live) {
      if (!this.store.add(update)) {
        this.ensureSnapshot(update.event_id);
        continue;
      }
      const state: SuperbetSubscriptionState = {
        id: `superbet:event:${update.event_id}`,
        eventId: update.event_id,
        generation: 0,
        attempt: 0,
        revision: 0,
        epoch: 0,
        accepting: true,
        connected: false,
        opens: 0,
        lastActivity: Date.now(),
        queue: Promise.resolve(),
        decoder: null,
        synchronizationTimer: null,
        restarting: null,
      };
      this.subscriptions.set(state.eventId, state);
      starts.push(
        this.open(state).catch((error: unknown) => {
          if (this.subscriptions.get(state.eventId) === state)
            this.store.remove(state.eventId);
          throw error;
        }),
      );
    }
    const results = await Promise.allSettled(starts);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        "Superbet subscription registration failed.",
      );
    this.handlers.onEvents(this.getEvents());
  }

  private refreshDiscovery(): void {
    if (this.stopping) return;
    void this.discover().catch((error: unknown) => {
      if (this.stopping) return;
      this.handlers.onError(`Superbet discovery failed: ${String(error)}`);
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

  private detach(id: number): void {
    const state = this.subscriptions.get(id);
    if (!state) return;
    this.clearSynchronizationTimer(id);
    state.decoder?.close();
    this.subscriptions.delete(id);
    this.queued.delete(id);
    const retry = this.retries.get(id);
    if (retry) clearTimeout(retry);
    this.retries.delete(id);
    this.failures.delete(id);
    this.track(
      this.network
        .command({ type: "stop-subscription", id: state.id })
        .catch((error: unknown) => {
          if (!this.stopping) this.handlers.onError(String(error), id);
        }),
    );
    this.handlers.onRemove(id);
  }

  private ensureSnapshot(id: number): void {
    if (
      this.stopping ||
      !this.subscriptions.get(id)?.connected ||
      !this.store.events.get(id)?.stale ||
      this.loading.has(id) ||
      this.retries.has(id)
    )
      return;
    this.queued.add(id);
    this.drain();
  }

  // REST repairs share a bounded queue and provider-wide Retry-After cooldown.
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
    for (const id of this.queued) {
      if (this.loading.size >= this.options.maxConcurrentSnapshots) break;
      this.queued.delete(id);
      const state = this.subscriptions.get(id);
      if (!state?.connected || !this.store.events.get(id)?.stale) continue;
      const revision = state.revision;
      this.loading.add(id);
      this.track(
        this.request(`/v3/ro-RO/events?events=${id}`)
          .then((updates) => {
            if (
              this.stopping ||
              this.subscriptions.get(id) !== state ||
              !state.connected ||
              state.revision !== revision
            )
              return;
            const snapshot = updates.find((update) => update.event_id === id);
            if (!snapshot) {
              this.store.remove(id);
              return;
            }
            this.store.install(snapshot);
            this.counters.snapshotRepairs++;
            this.failures.delete(id);
          })
          .catch((error: unknown) => {
            if (!this.stopping && this.subscriptions.get(id) === state) {
              this.counters.snapshotErrors++;
              this.failures.set(id, (this.failures.get(id) ?? 0) + 1);
              this.handlers.onError(String(error), id);
            }
          })
          .finally(() => {
            this.loading.delete(id);
            if (
              !this.stopping &&
              this.subscriptions.get(id)?.connected &&
              this.store.events.get(id)?.stale
            )
              this.scheduleRetry(id);
            this.drain();
          }),
      );
    }
  }

  private scheduleRetry(id: number): void {
    if (this.retries.has(id)) return;
    const delay = Math.max(
      Math.min(
        30_000,
        this.options.retryDelayMs *
          2 ** Math.min(this.failures.get(id) ?? 0, 5),
      ),
      this.cooldownUntil - Date.now(),
    );
    this.retries.set(
      id,
      setTimeout(() => {
        this.retries.delete(id);
        this.ensureSnapshot(id);
      }, delay),
    );
  }

  private async request(path: string): Promise<SuperbetUpdate[]> {
    if (Date.now() < this.cooldownUntil)
      throw new Error("Superbet HTTP cooldown is active.");
    const result = await this.network.command({
      type: "request",
      origin: this.options.origin,
      request: {
        path,
        method: "GET",
        headers: { accept: "application/json", "accept-encoding": "gzip" },
      },
    });
    if (result.type !== "request-response")
      throw new Error("Missing Superbet HTTP response.");
    const { response } = result;
    if (response.statusCode !== 200) {
      if ([429, 503].includes(response.statusCode)) {
        const retry = response.headers["retry-after"];
        const value = typeof retry === "string" ? retry : "30";
        const ms = /^\d+(\.\d+)?$/.test(value)
          ? Number(value) * 1_000
          : Date.parse(value) - Date.now();
        this.cooldownUntil = Math.max(
          this.cooldownUntil,
          Date.now() +
            Math.min(
              2_147_483_647,
              Math.max(1_000, Number.isFinite(ms) ? ms : 30_000),
            ),
        );
      }
      throw new SuperbetHttpError(response.statusCode);
    }
    const data = await decodeJson(
      response,
      this.options.maxDecodedMessageBytes,
    );
    if (
      !isRecord(data) ||
      !Array.isArray(data.events) ||
      !data.events.every(isUpdate)
    )
      throw new Error("Malformed Superbet events response.");
    return data.events;
  }

  private track(operation: Promise<unknown>): void {
    this.operations.add(operation);
    void operation.then(
      () => this.operations.delete(operation),
      () => this.operations.delete(operation),
    );
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    if (this.discoveryRetry) clearTimeout(this.discoveryRetry);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    for (const timer of this.retries.values()) clearTimeout(timer);
    this.retries.clear();
    this.queued.clear();
    const states = [...this.subscriptions.values()];
    for (const state of states) {
      this.clearSynchronizationTimer(state.eventId);
      state.connected = false;
      state.decoder?.close();
    }
    const results = await Promise.allSettled(
      states.map((state) =>
        this.network.command({ type: "stop-subscription", id: state.id }),
      ),
    );
    await Promise.allSettled([
      this.discovery,
      ...this.operations,
      ...states.map((state) => state.queue),
    ]);
    this.subscriptions.clear();
    this.football.clear();
    this.tennis.clear();
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length)
      throw new AggregateError(
        errors,
        "Superbet subscription shutdown failed.",
      );
  }
}
