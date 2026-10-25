import type { MessagePort } from "node:worker_threads";
import { isTennisContext, sameTennisContext } from "../protocol/tennis.js";
import type { AggregationMappingCondition } from "../model/mapping.interfaces.js";
import type {
  AggregationOutboxEvent,
  AggregationOutboxHandlers,
  AggregationOutboxStats,
} from "../model/outbox.interfaces.js";
import type {
  AggregationBatchMessage,
  AggregationEventIdentity,
  AggregationEventLive,
  AggregationOutboxOptions,
  AggregationProvider,
} from "../model/wire.interfaces.js";
import { isControlMessage, maxWireCounter } from "../protocol/validation.js";
import {
  BatchWriter,
  headerBytes,
  initialBatchBytes,
  isIdentity,
  isLineKey,
  isPrice,
  liveFlags,
  valueFlags,
} from "../protocol/wire.js";

/**
 * @file Coalesces provider changes into ordered binary batches with one batch in flight.
 */

const clean = 0;
const dirty = 1;
// Still listed for the current segment, but released; skipped when values are written.
const released = 2;
const maxPooledBuffers = 2;

const same = (a: number, b: number): boolean =>
  a === b || (Number.isNaN(a) && Number.isNaN(b));

// Reuses released handles first, so array sizes stay bounded by the configured limits.
class HandlePool {
  private readonly free: Uint32Array;
  private freeCount = 0;
  private next = 0;

  constructor(private readonly size: number) {
    this.free = new Uint32Array(size);
  }

  get used(): number {
    return this.next - this.freeCount;
  }

  acquire(): number {
    if (this.freeCount) return this.free[--this.freeCount]!;
    return this.next < this.size ? this.next++ : -1;
  }

  release(handle: number): void {
    this.free[this.freeCount++] = handle;
  }

  clear(): void {
    this.next = 0;
    this.freeCount = 0;
  }
}

export class AggregationOutbox {
  private options: AggregationOutboxOptions | null = null;
  private generation = 0;
  private sequence = 0;
  private inFlight = false;
  private closed = false;
  private resetting = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private immediate: ReturnType<typeof setImmediate> | null = null;
  private readonly writer = new BatchWriter();
  private readonly pool: ArrayBuffer[] = [];
  private readonly events = new Map<number, AggregationOutboxEvent>();
  private eventHandles = new HandlePool(0);
  private lineHandles = new HandlePool(0);
  // Latest value per line handle; a changed line is listed once until its segment is written.
  private priceA = new Float64Array(0);
  private priceB = new Float64Array(0);
  private flags = new Uint8Array(0);
  private marks = new Uint8Array(0);
  private dirtyList = new Uint32Array(0);
  private dirtyCount = 0;
  private readonly counters = {
    batches: 0,
    values: 0,
    coalescedValues: 0,
    resets: 0,
    rejected: 0,
  };

  constructor(
    private readonly port: MessagePort,
    private readonly provider: AggregationProvider,
    private readonly handlers: AggregationOutboxHandlers = {},
  ) {
    port.on("message", (message: unknown) => this.receive(message));
    port.once("close", () => this.close());
  }

  // Nothing is recorded before attach; the aggregator's limits size every array.
  get active(): boolean {
    return this.options !== null && !this.closed;
  }

  get conditions(): readonly AggregationMappingCondition[] {
    return this.options?.enabledConditions ?? [];
  }

  setEvent(identity: AggregationEventIdentity): boolean {
    if (!this.active) return false;
    if (!isIdentity(identity)) return this.reject();
    let event = this.events.get(identity.eventId);
    if (event === undefined) {
      const handle = this.eventHandles.acquire();
      if (handle < 0) return this.reject();
      event = {
        handle,
        lines: new Map(),
        liveFlags: -1,
        homeScore: 0,
        awayScore: 0,
        clockSeconds: 0,
      };
      this.events.set(identity.eventId, event);
    }
    this.writer.eventIdentity(event.handle, identity);
    this.written(false);
    return true;
  }

  // Score, phase, and suspension changes close the segment so older prices cannot follow them.
  setLive(eventId: number, live: AggregationEventLive): boolean {
    if (!this.active) return false;
    const event = this.events.get(eventId);
    if (event === undefined) return this.reject();
    let contextChanged = false;
    if (live.tennis !== undefined) {
      if (!isTennisContext(live.tennis)) {
        this.setSynchronized(eventId, false);
        return this.reject();
      }
      if (!sameTennisContext(event.tennis, live.tennis)) {
        this.closeSegment();
        this.writer.eventTennis(event.handle, live.tennis);
        event.tennis = live.tennis;
        contextChanged = true;
      }
    }
    const score =
      live.homeScore !== null &&
      live.awayScore !== null &&
      Number.isSafeInteger(live.homeScore) &&
      Number.isSafeInteger(live.awayScore) &&
      live.homeScore >= 0 &&
      live.awayScore >= 0 &&
      live.homeScore <= 0xffff &&
      live.awayScore <= 0xffff;
    const clock =
      live.clockSeconds !== null &&
      Number.isSafeInteger(live.clockSeconds) &&
      live.clockSeconds >= 0 &&
      live.clockSeconds <= maxWireCounter;
    const flags =
      (live.live ? liveFlags.live : 0) |
      (live.suspended ? liveFlags.suspended : 0) |
      (score ? liveFlags.score : 0) |
      (clock ? liveFlags.clock : 0) |
      (clock && live.clockRunning ? liveFlags.running : 0) |
      (live.synchronized === false ? liveFlags.stale : 0);
    const home = score ? live.homeScore! : 0;
    const away = score ? live.awayScore! : 0;
    const seconds = clock ? live.clockSeconds! : 0;
    if (
      flags === event.liveFlags &&
      home === event.homeScore &&
      away === event.awayScore &&
      seconds === event.clockSeconds
    ) {
      if (contextChanged) this.written(true);
      return true;
    }
    const material =
      event.liveFlags < 0 ||
      ((flags ^ event.liveFlags) & ~liveFlags.clock) !== 0 ||
      home !== event.homeScore ||
      away !== event.awayScore;
    if (material) this.closeSegment();
    this.writer.eventLive(event.handle, flags, home, away, seconds);
    event.liveFlags = flags;
    event.homeScore = home;
    event.awayScore = away;
    event.clockSeconds = seconds;
    this.written(material || contextChanged);
    return true;
  }

  // Synchronization changes preserve the event's last known metadata and handles.
  setSynchronized(eventId: number, synchronized: boolean): void {
    const event = this.events.get(eventId);
    if (!this.active || event === undefined || event.liveFlags < 0) return;
    const flags = synchronized
      ? event.liveFlags & ~liveFlags.stale
      : event.liveFlags | liveFlags.stale;
    if (flags === event.liveFlags) return;
    this.closeSegment();
    this.writer.eventLive(
      event.handle,
      flags,
      event.homeScore,
      event.awayScore,
      event.clockSeconds,
    );
    event.liveFlags = flags;
    this.written(true);
  }

  // The hot path: two map lookups, typed-array writes, and no allocation for known lines.
  setLine(
    eventId: number,
    key: number,
    priceA: number,
    priceB: number,
    usableA: boolean,
    usableB: boolean,
  ): boolean {
    if (!this.active) return false;
    const event = this.events.get(eventId);
    if (event === undefined || !isLineKey(key)) return this.reject();
    const a = isPrice(priceA) ? priceA : NaN;
    const b = isPrice(priceB) ? priceB : NaN;
    const flags =
      (usableA && !Number.isNaN(a) ? valueFlags.usableA : 0) |
      (usableB && !Number.isNaN(b) ? valueFlags.usableB : 0);
    let line = event.lines.get(key);
    if (line === undefined) {
      line = this.lineHandles.acquire();
      if (line < 0) return this.reject();
      event.lines.set(key, line);
      this.writer.lineDefine(line, event.handle, key);
    } else if (
      same(this.priceA[line]!, a) &&
      same(this.priceB[line]!, b) &&
      this.flags[line] === flags
    )
      return true;
    this.priceA[line] = a;
    this.priceB[line] = b;
    this.flags[line] = flags;
    this.mark(line);
    this.written(false);
    return true;
  }

  releaseLine(eventId: number, key: number): boolean {
    if (!this.active) return false;
    const event = this.events.get(eventId);
    const line = event?.lines.get(key);
    if (event === undefined || line === undefined) return false;
    event.lines.delete(key);
    this.dropLine(line);
    this.written(false);
    return true;
  }

  // Invalidation is urgent: the aggregator must stop using the event as soon as possible.
  releaseEvent(eventId: number): boolean {
    if (!this.active) return false;
    const event = this.events.get(eventId);
    if (event === undefined) return false;
    for (const line of event.lines.values()) this.dropLine(line);
    this.writer.eventRelease(event.handle);
    this.eventHandles.release(event.handle);
    this.events.delete(eventId);
    this.written(true);
    return true;
  }

  getStats(): AggregationOutboxStats {
    return {
      attached: this.active,
      events: this.eventHandles.used,
      lines: this.lineHandles.used,
      inFlight: this.inFlight,
      ...this.counters,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.events.clear();
    this.port.close();
  }

  private receive(message: unknown): void {
    if (this.closed) return;
    if (!isControlMessage(message)) {
      this.handlers.onError?.("Invalid aggregation control message.");
      return;
    }
    if (message.type === "attach") {
      if (this.options !== null)
        this.handlers.onError?.("Aggregation port is already attached.");
      else this.attach(message.generation, message.options);
      return;
    }
    if (
      !this.inFlight ||
      message.generation !== this.generation ||
      message.sequence !== this.sequence
    ) {
      this.handlers.onError?.(`Unexpected aggregation ${message.type}.`);
      return;
    }
    this.inFlight = false;
    if (message.type === "resync") {
      this.reset();
      return;
    }
    if (
      this.pool.length < maxPooledBuffers &&
      message.buffer.byteLength >= headerBytes
    )
      this.pool.push(message.buffer);
    if (!this.writer.empty || this.dirtyCount) this.schedule(true);
  }

  private attach(generation: number, options: AggregationOutboxOptions): void {
    this.options = options;
    this.generation = generation;
    this.eventHandles = new HandlePool(options.maxEvents);
    this.lineHandles = new HandlePool(options.maxLines);
    this.priceA = new Float64Array(options.maxLines);
    this.priceB = new Float64Array(options.maxLines);
    this.flags = new Uint8Array(options.maxLines);
    this.marks = new Uint8Array(options.maxLines);
    this.dirtyList = new Uint32Array(options.maxLines);
    this.reset();
  }

  // Discard every handle and re-emit the projection behind a reset operation.
  private reset(): void {
    if (this.resetting)
      throw new Error("Aggregation state exceeds the batch limit.");
    this.resetting = true;
    try {
      this.counters.resets++;
      this.events.clear();
      this.eventHandles.clear();
      this.lineHandles.clear();
      this.marks.fill(clean);
      this.dirtyCount = 0;
      this.writer.reset();
      this.writer.writeReset();
      this.handlers.onResync?.();
    } finally {
      this.resetting = false;
    }
    this.schedule(true);
  }

  // Invalid input from the adapter is counted, never written.
  private reject(): false {
    this.counters.rejected++;
    return false;
  }

  private mark(line: number): void {
    const state = this.marks[line];
    if (state === dirty) {
      this.counters.coalescedValues++;
      return;
    }
    if (state === clean) this.dirtyList[this.dirtyCount++] = line;
    this.marks[line] = dirty;
  }

  private dropLine(line: number): void {
    if (this.marks[line] === dirty) this.marks[line] = released;
    this.writer.lineRelease(line);
    this.lineHandles.release(line);
  }

  // Write the latest value of each changed line after the operations already in the segment.
  private closeSegment(): void {
    for (let index = 0; index < this.dirtyCount; index++) {
      const line = this.dirtyList[index]!;
      if (this.marks[line] === dirty) {
        this.writer.value(
          line,
          this.priceA[line]!,
          this.priceB[line]!,
          this.flags[line]!,
        );
        this.counters.values++;
      }
      this.marks[line] = clean;
    }
    this.dirtyCount = 0;
    this.writer.closeSegment();
  }

  // A pending batch beyond the limit means the aggregator stopped acknowledging; restart from state.
  private written(urgent: boolean): void {
    if (this.writer.byteLength > this.options!.maxBatchBytes) {
      this.reset();
      return;
    }
    this.schedule(urgent);
  }

  private schedule(urgent: boolean): void {
    if (this.inFlight || this.closed || this.resetting) return;
    if (urgent) {
      if (this.immediate !== null) return;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.immediate = setImmediate(() => this.flush());
      return;
    }
    if (this.timer === null && this.immediate === null)
      this.timer = setTimeout(() => this.flush(), this.options!.batchWindowMs);
  }

  private flush(): void {
    this.clearTimers();
    if (this.inFlight || !this.active) return;
    this.closeSegment();
    // Pending values are encoded here, so check the final size before transferring.
    if (this.writer.byteLength > this.options!.maxBatchBytes) {
      this.reset();
      return;
    }
    if (this.writer.empty) return;
    if (this.sequence >= maxWireCounter) {
      this.handlers.onError?.("Aggregation sequence limit reached.");
      this.close();
      return;
    }
    const sequence = this.sequence + 1;
    const buffer = this.writer.finish(
      this.provider,
      this.generation,
      sequence,
      Date.now(),
    );
    this.sequence = sequence;
    this.inFlight = true;
    this.counters.batches++;
    this.writer.reset(this.pool.pop() ?? new ArrayBuffer(initialBatchBytes));
    try {
      this.port.postMessage(
        {
          type: "batch",
          generation: this.generation,
          sequence,
          buffer,
        } satisfies AggregationBatchMessage,
        [buffer],
      );
    } catch (error) {
      this.handlers.onError?.(`Aggregation batch failed: ${String(error)}`);
      this.close();
    }
  }

  private clearTimers(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.immediate !== null) clearImmediate(this.immediate);
    this.timer = null;
    this.immediate = null;
  }
}
