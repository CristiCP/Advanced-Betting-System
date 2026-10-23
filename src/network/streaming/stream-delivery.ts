import type { StreamDeliveryOptions } from "../model/stream-delivery.interfaces.js";

/**
 * @file Limits unacknowledged stream bytes without inspecting their contents.
 */

export class StreamDelivery {
  private readonly options: StreamDeliveryOptions;
  private readonly pending = new Map<number, number>();
  private pendingBytes = 0;
  private nextSequence = 1;

  // Treat the byte limit as a high-water mark, allowing the accepted final chunk.
  constructor(options: StreamDeliveryOptions) {
    if (
      !Number.isSafeInteger(options.maxInFlightBytes) ||
      options.maxInFlightBytes <= 0
    ) {
      throw new Error(
        "SSE delivery byte limit must be a positive safe integer.",
      );
    }
    this.options = { ...options };
  }

  // Account for bytes before handing over ownership of their ArrayBuffer.
  send(attempt: number, chunk: ArrayBuffer): boolean {
    const sequence = this.nextSequence++;
    if (!Number.isSafeInteger(sequence)) {
      throw new Error("SSE chunk sequence limit reached.");
    }
    const bytes = chunk.byteLength;
    this.pending.set(sequence, bytes);
    this.pendingBytes += bytes;
    try {
      this.options.onChunk(attempt, sequence, chunk);
    } catch (error) {
      this.pending.delete(sequence);
      this.pendingBytes -= bytes;
      throw error;
    }
    return this.pendingBytes < this.options.maxInFlightBytes;
  }

  // Ignore duplicate acknowledgements and allow completion in any order.
  acknowledge(sequence: number): boolean {
    const bytes = this.pending.get(sequence);
    if (bytes !== undefined) {
      this.pending.delete(sequence);
      this.pendingBytes -= bytes;
    }
    return this.pendingBytes < this.options.maxInFlightBytes;
  }
}
