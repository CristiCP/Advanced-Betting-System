/**
 * @file Stores one provider's lines as struct-of-arrays indexed by the wire line handle.
 */

export class QuoteBook {
  readonly lineEvent: Int32Array;
  readonly lineKey: Uint32Array;
  readonly priceA: Float64Array;
  readonly priceB: Float64Array;
  readonly flags: Uint8Array;
  readonly updatedAt: Float64Array;
  // Line handle of the equivalent line at the other provider, or -1.
  readonly peer: Int32Array;

  constructor(maxLines: number) {
    this.lineEvent = new Int32Array(maxLines).fill(-1);
    this.lineKey = new Uint32Array(maxLines);
    this.priceA = new Float64Array(maxLines).fill(NaN);
    this.priceB = new Float64Array(maxLines).fill(NaN);
    this.flags = new Uint8Array(maxLines);
    this.updatedAt = new Float64Array(maxLines);
    this.peer = new Int32Array(maxLines).fill(-1);
  }

  define(line: number, event: number, key: number): void {
    this.lineEvent[line] = event;
    this.lineKey[line] = key;
    this.priceA[line] = NaN;
    this.priceB[line] = NaN;
    this.flags[line] = 0;
    this.updatedAt[line] = 0;
    this.peer[line] = -1;
  }

  // A defined line without a value yet has no usable flags, so it is never compared.
  value(
    line: number,
    priceA: number,
    priceB: number,
    flags: number,
    at: number,
  ): void {
    this.priceA[line] = priceA;
    this.priceB[line] = priceB;
    this.flags[line] = flags;
    this.updatedAt[line] = at;
  }

  release(line: number): void {
    this.lineEvent[line] = -1;
    this.flags[line] = 0;
    this.peer[line] = -1;
  }

  clear(): void {
    this.lineEvent.fill(-1);
    this.flags.fill(0);
    this.peer.fill(-1);
  }
}
