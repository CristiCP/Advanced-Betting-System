import type { MessagePort } from "node:worker_threads";
import type {
  AggregationProviderSink,
  AggregationSessionHandlers,
  AggregationSessionStats,
} from "../model/session.interfaces.js";
import type {
  AggregationBatchSink,
  AggregationControlMessage,
  AggregationEventIdentity,
  AggregationOutboxOptions,
  AggregationProvider,
} from "../model/wire.interfaces.js";
import { isBatchMessage } from "../protocol/validation.js";
import { WireError, readBatch, readHeader } from "../protocol/wire.js";

/**
 * @file Validates one provider's ordered batches and owns the handle lifecycle on the aggregator side.
 */

export class AggregationSession implements AggregationBatchSink {
  private readonly eventDefined: Uint8Array;
  private readonly eventLines: Uint32Array;
  private readonly lineEvent: Int32Array;
  private events = 0;
  private lines = 0;
  private sequence = 0;
  // Every attach and every rejected batch must be followed by a batch that starts with reset.
  private awaitingReset = true;
  private touched = false;
  private connected = false;
  private closed = false;
  private readonly counters = {
    batches: 0,
    operations: 0,
    values: 0,
    bytes: 0,
    resyncs: 0,
  };
  private lagMs = 0;
  private maxLagMs = 0;
  private maxApplyMs = 0;

  constructor(
    readonly provider: AggregationProvider,
    private readonly port: MessagePort,
    private readonly generation: number,
    private readonly options: AggregationOutboxOptions,
    private readonly handlers: AggregationSessionHandlers,
    // Receives each operation after it passed validation; cleared together with this session.
    private readonly downstream: AggregationProviderSink | null = null,
  ) {
    this.eventDefined = new Uint8Array(options.maxEvents);
    this.eventLines = new Uint32Array(options.maxEvents);
    this.lineEvent = new Int32Array(options.maxLines).fill(-1);
  }

  start(): void {
    if (this.connected || this.closed) return;
    this.connected = true;
    this.port.on("message", (message: unknown) => this.receive(message));
    this.port.once("close", () => {
      this.connected = false;
      this.closed = true;
      this.clear();
    });
    // Send only the outbox limits; the aggregator's own settings stay in this worker.
    const { batchWindowMs, maxEvents, maxLines, maxBatchBytes, enabledConditions } =
      this.options;
    this.post({
      type: "attach",
      generation: this.generation,
      options: {
        batchWindowMs,
        maxEvents,
        maxLines,
        maxBatchBytes,
        enabledConditions,
      },
    });
  }

  getStats(resetWindow = false): AggregationSessionStats {
    const stats: AggregationSessionStats = {
      connected: this.connected,
      generation: this.generation,
      sequence: this.sequence,
      events: this.events,
      lines: this.lines,
      ...this.counters,
      lagMs: this.lagMs,
      maxLagMs: this.maxLagMs,
      maxApplyMs: Math.round(this.maxApplyMs * 1_000) / 1_000,
    };
    if (resetWindow) {
      this.maxLagMs = 0;
      this.maxApplyMs = 0;
    }
    return stats;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    this.clear();
    this.port.close();
  }

  private receive(message: unknown): void {
    if (this.closed) return;
    // Without a valid envelope the provider cannot be told which batch failed; drop the link.
    if (!isBatchMessage(message)) {
      this.handlers.onError(this.provider, "Invalid aggregation batch message.");
      this.close();
      return;
    }
    const started = performance.now();
    try {
      const header = readHeader(message.buffer);
      if (
        header.provider !== this.provider ||
        header.generation !== this.generation ||
        header.generation !== message.generation ||
        header.sequence !== message.sequence
      )
        throw new WireError("Batch header does not match its envelope.");
      const expected = this.sequence + 1;
      this.sequence = header.sequence;
      if (header.sequence !== expected)
        throw new WireError(`Batch sequence gap: expected ${expected}.`);
      if (header.byteLength > this.options.maxBatchBytes)
        throw new WireError("Batch exceeds the configured limit.");
      this.touched = false;
      this.downstream?.begin(Date.now());
      readBatch(message.buffer, header, this);
      if (this.awaitingReset)
        throw new WireError("Expected reset after resynchronization.");
      this.downstream?.commit(header.sentAt);
      const now = Date.now();
      this.counters.batches++;
      this.counters.bytes += header.byteLength;
      this.lagMs = Math.max(0, now - header.sentAt);
      this.maxLagMs = Math.max(this.maxLagMs, this.lagMs);
      this.maxApplyMs = Math.max(this.maxApplyMs, performance.now() - started);
      this.post(
        {
          type: "ack",
          generation: this.generation,
          sequence: header.sequence,
          buffer: message.buffer,
        },
        [message.buffer],
      );
    } catch (error) {
      // Partially applied state is never kept: discard the provider and request a full re-emission.
      this.sequence = message.sequence;
      this.clear();
      this.awaitingReset = true;
      this.counters.resyncs++;
      this.handlers.onError(
        this.provider,
        `Batch ${message.sequence} rejected: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.post({
        type: "resync",
        generation: this.generation,
        sequence: message.sequence,
      });
    }
  }

  reset(): void {
    if (this.touched) throw new WireError("Reset must start a batch.");
    this.touched = true;
    this.counters.operations++;
    this.clear();
    this.awaitingReset = false;
  }

  eventIdentity(event: number, identity: AggregationEventIdentity): void {
    this.operation();
    if (event >= this.options.maxEvents)
      throw new WireError("Event handle is out of range.");
    if (!this.eventDefined[event]) {
      this.eventDefined[event] = 1;
      this.events++;
    }
    this.downstream?.eventIdentity(event, identity);
  }

  eventLive(
    event: number,
    flags: number,
    homeScore: number,
    awayScore: number,
    clockSeconds: number,
  ): void {
    this.operation();
    this.requireEvent(event);
    this.downstream?.eventLive(event, flags, homeScore, awayScore, clockSeconds);
  }

  eventRelease(event: number): void {
    this.operation();
    this.requireEvent(event);
    if (this.eventLines[event])
      throw new WireError("Event released before its lines.");
    this.eventDefined[event] = 0;
    this.events--;
    this.downstream?.eventRelease(event);
  }

  lineDefine(line: number, event: number, key: number): void {
    this.operation();
    this.requireEvent(event);
    if (line >= this.options.maxLines || this.lineEvent[line] !== -1)
      throw new WireError("Line handle is out of range or already defined.");
    this.lineEvent[line] = event;
    this.eventLines[event]!++;
    this.lines++;
    this.downstream?.lineDefine(line, event, key);
  }

  lineRelease(line: number): void {
    this.operation();
    const event = this.requireLine(line);
    // Notify first: the downstream state still needs the line's event and key.
    this.downstream?.lineRelease(line);
    this.lineEvent[line] = -1;
    this.eventLines[event]!--;
    this.lines--;
  }

  value(line: number, priceA: number, priceB: number, flags: number): void {
    if (this.awaitingReset)
      throw new WireError("Expected reset after resynchronization.");
    this.touched = true;
    this.requireLine(line);
    this.counters.values++;
    this.downstream?.value(line, priceA, priceB, flags);
  }

  private operation(): void {
    if (this.awaitingReset)
      throw new WireError("Expected reset after resynchronization.");
    this.touched = true;
    this.counters.operations++;
  }

  private requireEvent(event: number): void {
    if (event >= this.options.maxEvents || !this.eventDefined[event])
      throw new WireError("Event handle is not defined.");
  }

  private requireLine(line: number): number {
    const event = line < this.options.maxLines ? this.lineEvent[line]! : -1;
    if (event < 0) throw new WireError("Line handle is not defined.");
    return event;
  }

  private clear(): void {
    this.downstream?.clear();
    this.eventDefined.fill(0);
    this.eventLines.fill(0);
    this.lineEvent.fill(-1);
    this.events = 0;
    this.lines = 0;
  }

  private post(
    message: AggregationControlMessage,
    transfer: ArrayBuffer[] = [],
  ): void {
    if (this.closed) return;
    try {
      this.port.postMessage(message, transfer);
    } catch (error) {
      this.handlers.onError(this.provider, `Port failed: ${String(error)}`);
      this.close();
    }
  }
}
