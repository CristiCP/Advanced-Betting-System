import type {
  AggregationBatchHeader,
  AggregationBatchSink,
  AggregationEventIdentity,
  AggregationProvider,
} from "../model/wire.interfaces.js";
import type { AggregationTennisContext } from "../model/tennis.interfaces.js";
import {
  readTennisContext,
  writeTennisContext,
  tennisContextBytes,
} from "./tennis.js";

/**
 * @file Encodes and decodes transferable aggregation batches with fixed-width value records.
 */

export const wireMagic = 0x41474231;
export const wireVersion = 3;
export const headerBytes = 32;
export const segmentBytes = 8;
export const valueBytes = 21;
export const maxNameLength = 128;
export const maxPrice = 10_000;
const maxNameBytes = maxNameLength * 3;
const identityBytes = 45;
const liveBytes = 14;
const handleBytes = 5;
const lineDefineBytes = 13;
export const initialBatchBytes = 64 * 1024;

export const operations = {
  reset: 0,
  eventIdentity: 1,
  eventLive: 2,
  eventRelease: 3,
  lineDefine: 4,
  lineRelease: 5,
  eventTennis: 6,
} as const;

// A running clock advances from the moment it was received; a stopped one stays at its value.
export const liveFlags = {
  live: 1,
  suspended: 2,
  score: 4,
  clock: 8,
  running: 16,
  stale: 32,
} as const;
export const valueFlags = { usableA: 1, usableB: 2 } as const;

const providerCodes: Record<AggregationProvider, number> = {
  superbet: 1,
  betano: 2,
};
const providerNames: readonly (AggregationProvider | undefined)[] = [
  undefined,
  "superbet",
  "betano",
];

export class WireError extends Error {}

export const isIdentifier = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;
const isOptionalIdentifier = (value: number): boolean =>
  value === 0 || isIdentifier(value);
export const isPrice = (value: number): boolean =>
  Number.isFinite(value) && value > 1 && value <= maxPrice;

export function isName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxNameLength &&
    value.trim() !== ""
  );
}

export function isIdentity(identity: AggregationEventIdentity): boolean {
  return (
    isIdentifier(identity.eventId) &&
    isOptionalIdentifier(identity.betradarId) &&
    (Number.isNaN(identity.startsAt) ||
      (Number.isSafeInteger(identity.startsAt) && identity.startsAt >= 0)) &&
    isOptionalIdentifier(identity.competitionId) &&
    isOptionalIdentifier(identity.categoryId) &&
    isName(identity.home) &&
    isName(identity.away) &&
    identity.home !== identity.away
  );
}

// Market code (12 bits), signed line in quarter units (16 bits) and variant (4 bits) fit an unsigned 32-bit key.
export function lineKey(
  code: number,
  quarters: number,
  variant = 0,
): number | null {
  return Number.isInteger(code) &&
    code >= 1 &&
    code <= 4095 &&
    Number.isInteger(quarters) &&
    quarters >= -32_768 &&
    quarters <= 32_767 &&
    Number.isInteger(variant) &&
    variant >= 0 &&
    variant <= 15
    ? code * 2 ** 20 + (quarters + 32_768) * 16 + variant
    : null;
}

export function isLineKey(key: number): boolean {
  return (
    Number.isInteger(key) && key >= 0 && key <= 0xffff_ffff && key >>> 20 >= 1
  );
}

export const lineCode = (key: number): number => key >>> 20;
export const lineQuarters = (key: number): number =>
  ((key >>> 4) & 0xffff) - 32_768;
export const lineVariant = (key: number): number => key & 0xf;

// Worst case for re-emitting the complete state after a reset; batches must always fit it.
export function fullStateBytes(maxEvents: number, maxLines: number): number {
  return (
    headerBytes +
    segmentBytes +
    1 +
    maxEvents *
      (identityBytes +
        2 * (2 + maxNameBytes) +
        liveBytes +
        5 +
        tennisContextBytes +
        3 * segmentBytes) +
    maxLines * (lineDefineBytes + valueBytes + segmentBytes)
  );
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

// Appends operations and values into one reusable buffer; operations always precede values in a segment.
export class BatchWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array;
  private offset = headerBytes;
  private segments = 0;
  private segmentStart = -1;
  private ops = 0;
  private values = 0;

  constructor(buffer: ArrayBuffer = new ArrayBuffer(initialBatchBytes)) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
  }

  get byteLength(): number {
    return this.offset;
  }

  get empty(): boolean {
    return this.segments === 0 && this.ops + this.values === 0;
  }

  reset(buffer?: ArrayBuffer): void {
    if (buffer !== undefined && buffer.byteLength >= headerBytes) {
      this.buffer = buffer;
      this.view = new DataView(buffer);
      this.bytes = new Uint8Array(buffer);
    }
    this.offset = headerBytes;
    this.segments = 0;
    this.segmentStart = -1;
    this.ops = 0;
    this.values = 0;
  }

  closeSegment(): void {
    if (this.segmentStart < 0) return;
    if (this.ops + this.values === 0) this.offset = this.segmentStart;
    else {
      this.view.setUint32(this.segmentStart, this.ops, true);
      this.view.setUint32(this.segmentStart + 4, this.values, true);
      this.segments++;
    }
    this.segmentStart = -1;
    this.ops = 0;
    this.values = 0;
  }

  writeReset(): void {
    this.operation(operations.reset, 1);
  }

  eventIdentity(event: number, identity: AggregationEventIdentity): void {
    const at = this.operation(
      operations.eventIdentity,
      identityBytes + 2 * (2 + maxNameBytes),
    );
    this.view.setUint32(at, event, true);
    this.view.setFloat64(at + 4, identity.eventId, true);
    this.view.setFloat64(at + 12, identity.betradarId, true);
    this.view.setFloat64(at + 20, identity.startsAt, true);
    this.view.setFloat64(at + 28, identity.competitionId, true);
    this.view.setFloat64(at + 36, identity.categoryId, true);
    // Reserve the upper bound, then trim to the encoded length.
    this.offset = this.name(this.name(at + 44, identity.home), identity.away);
  }

  eventLive(
    event: number,
    flags: number,
    homeScore: number,
    awayScore: number,
    clockSeconds: number,
  ): void {
    const at = this.operation(operations.eventLive, liveBytes);
    this.view.setUint32(at, event, true);
    this.view.setUint8(at + 4, flags);
    this.view.setUint16(at + 5, homeScore, true);
    this.view.setUint16(at + 7, awayScore, true);
    this.view.setUint32(at + 9, clockSeconds, true);
  }

  eventRelease(event: number): void {
    const at = this.operation(operations.eventRelease, handleBytes);
    this.view.setUint32(at, event, true);
  }

  eventTennis(event: number, context: AggregationTennisContext): void {
    const at = this.operation(operations.eventTennis, 5 + tennisContextBytes);
    this.view.setUint32(at, event, true);
    writeTennisContext(this.view, at + 4, context);
  }

  lineDefine(line: number, event: number, key: number): void {
    const at = this.operation(operations.lineDefine, lineDefineBytes);
    this.view.setUint32(at, line, true);
    this.view.setUint32(at + 4, event, true);
    this.view.setUint32(at + 8, key, true);
  }

  lineRelease(line: number): void {
    const at = this.operation(operations.lineRelease, handleBytes);
    this.view.setUint32(at, line, true);
  }

  value(line: number, priceA: number, priceB: number, flags: number): void {
    this.open();
    this.ensure(valueBytes);
    const at = this.offset;
    this.view.setUint32(at, line, true);
    this.view.setFloat64(at + 4, priceA, true);
    this.view.setFloat64(at + 12, priceB, true);
    this.view.setUint8(at + 20, flags);
    this.offset += valueBytes;
    this.values++;
  }

  // Seal the header; the caller transfers the returned buffer and resets the writer.
  finish(
    provider: AggregationProvider,
    generation: number,
    sequence: number,
    sentAt: number,
  ): ArrayBuffer {
    this.closeSegment();
    const view = this.view;
    view.setUint32(0, wireMagic, true);
    view.setUint16(4, wireVersion, true);
    view.setUint8(6, providerCodes[provider]);
    view.setUint8(7, 0);
    view.setUint32(8, generation, true);
    view.setUint32(12, sequence, true);
    view.setFloat64(16, sentAt, true);
    view.setUint32(24, this.offset, true);
    view.setUint32(28, this.segments, true);
    return this.buffer;
  }

  private open(): void {
    if (this.segmentStart >= 0) return;
    this.ensure(segmentBytes);
    this.segmentStart = this.offset;
    this.offset += segmentBytes;
  }

  // An operation after values starts a new segment, preserving operation-before-value order.
  private operation(code: number, bytes: number): number {
    if (this.values) this.closeSegment();
    this.open();
    this.ensure(bytes);
    this.view.setUint8(this.offset, code);
    const at = this.offset + 1;
    this.offset += bytes;
    this.ops++;
    return at;
  }

  private name(at: number, value: string): number {
    const { written } = encoder.encodeInto(
      value,
      this.bytes.subarray(at + 2, at + 2 + maxNameBytes),
    );
    this.view.setUint16(at, written, true);
    return at + 2 + written;
  }

  private ensure(bytes: number): void {
    const required = this.offset + bytes;
    if (required <= this.buffer.byteLength) return;
    let size = Math.max(this.buffer.byteLength * 2, initialBatchBytes);
    while (size < required) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(this.bytes.subarray(0, this.offset));
    this.buffer = next;
    this.view = new DataView(next);
    this.bytes = new Uint8Array(next);
  }
}

export function readHeader(buffer: unknown): AggregationBatchHeader {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < headerBytes)
    throw new WireError("Batch is shorter than its header.");
  const view = new DataView(buffer);
  if (
    view.getUint32(0, true) !== wireMagic ||
    view.getUint16(4, true) !== wireVersion ||
    view.getUint8(7) !== 0
  )
    throw new WireError("Unsupported batch format.");
  const provider = providerNames[view.getUint8(6)];
  const sentAt = view.getFloat64(16, true);
  const byteLength = view.getUint32(24, true);
  if (provider === undefined) throw new WireError("Unknown batch provider.");
  if (!Number.isSafeInteger(sentAt) || sentAt < 0)
    throw new WireError("Invalid batch timestamp.");
  if (byteLength < headerBytes || byteLength > buffer.byteLength)
    throw new WireError("Invalid batch length.");
  return {
    provider,
    generation: view.getUint32(8, true),
    sequence: view.getUint32(12, true),
    sentAt,
    byteLength,
    segments: view.getUint32(28, true),
  };
}

// Validate every record while decoding; the caller discards all provider state if this throws.
export function readBatch(
  buffer: ArrayBuffer,
  header: AggregationBatchHeader,
  sink: AggregationBatchSink,
): void {
  const view = new DataView(buffer);
  const end = header.byteLength;
  let offset = headerBytes;
  const need = (bytes: number): void => {
    if (offset + bytes > end)
      throw new WireError("Batch ends inside a record.");
  };
  const name = (): string => {
    need(2);
    const length = view.getUint16(offset, true);
    offset += 2;
    if (length === 0 || length > maxNameBytes)
      throw new WireError("Invalid team name length.");
    need(length);
    let value: string;
    try {
      value = decoder.decode(new Uint8Array(buffer, offset, length));
    } catch {
      throw new WireError("Team name is not valid UTF-8.");
    }
    offset += length;
    if (!isName(value)) throw new WireError("Invalid team name.");
    return value;
  };
  for (let segment = 0; segment < header.segments; segment++) {
    need(segmentBytes);
    const ops = view.getUint32(offset, true);
    const values = view.getUint32(offset + 4, true);
    offset += segmentBytes;
    if (ops + values === 0) throw new WireError("Empty batch segment.");
    for (let index = 0; index < ops; index++) {
      need(1);
      const code = view.getUint8(offset);
      switch (code) {
        case operations.reset:
          offset += 1;
          sink.reset();
          break;
        case operations.eventIdentity: {
          need(identityBytes);
          const event = view.getUint32(offset + 1, true);
          const eventId = view.getFloat64(offset + 5, true);
          const betradarId = view.getFloat64(offset + 13, true);
          const startsAt = view.getFloat64(offset + 21, true);
          const competitionId = view.getFloat64(offset + 29, true);
          const categoryId = view.getFloat64(offset + 37, true);
          offset += identityBytes;
          const identity: AggregationEventIdentity = {
            eventId,
            betradarId,
            startsAt,
            competitionId,
            categoryId,
            home: name(),
            away: name(),
          };
          if (!isIdentity(identity))
            throw new WireError("Invalid event identity.");
          sink.eventIdentity(event, identity);
          break;
        }
        case operations.eventLive: {
          need(liveBytes);
          const event = view.getUint32(offset + 1, true);
          const flags = view.getUint8(offset + 5);
          const home = view.getUint16(offset + 6, true);
          const away = view.getUint16(offset + 8, true);
          const clock = view.getUint32(offset + 10, true);
          offset += liveBytes;
          if (
            flags & 0xc0 ||
            (!(flags & liveFlags.score) && (home || away)) ||
            (!(flags & liveFlags.clock) && (clock || flags & liveFlags.running))
          )
            throw new WireError("Invalid live state.");
          sink.eventLive(event, flags, home, away, clock);
          break;
        }
        case operations.eventRelease:
          need(handleBytes);
          sink.eventRelease(view.getUint32(offset + 1, true));
          offset += handleBytes;
          break;
        case operations.eventTennis: {
          need(5 + tennisContextBytes);
          const event = view.getUint32(offset + 1, true);
          const context = readTennisContext(view, offset + 5);
          if (!context) throw new WireError("Invalid tennis context.");
          offset += 5 + tennisContextBytes;
          if (!sink.eventTennis)
            throw new WireError("Unexpected tennis context.");
          sink.eventTennis(event, context);
          break;
        }
        case operations.lineDefine: {
          need(lineDefineBytes);
          const line = view.getUint32(offset + 1, true);
          const event = view.getUint32(offset + 5, true);
          const key = view.getUint32(offset + 9, true);
          offset += lineDefineBytes;
          if (!isLineKey(key)) throw new WireError("Invalid line key.");
          sink.lineDefine(line, event, key);
          break;
        }
        case operations.lineRelease:
          need(handleBytes);
          sink.lineRelease(view.getUint32(offset + 1, true));
          offset += handleBytes;
          break;
        default:
          throw new WireError(`Unknown batch operation ${code}.`);
      }
    }
    need(values * valueBytes);
    for (let index = 0; index < values; index++) {
      const line = view.getUint32(offset, true);
      const priceA = view.getFloat64(offset + 4, true);
      const priceB = view.getFloat64(offset + 12, true);
      const flags = view.getUint8(offset + 20);
      offset += valueBytes;
      if (
        flags & ~(valueFlags.usableA | valueFlags.usableB) ||
        !(Number.isNaN(priceA) || isPrice(priceA)) ||
        !(Number.isNaN(priceB) || isPrice(priceB)) ||
        (flags & valueFlags.usableA && !isPrice(priceA)) ||
        (flags & valueFlags.usableB && !isPrice(priceB))
      )
        throw new WireError("Invalid line value.");
      sink.value(line, priceA, priceB, flags);
    }
  }
  if (offset !== end) throw new WireError("Batch has trailing bytes.");
}
