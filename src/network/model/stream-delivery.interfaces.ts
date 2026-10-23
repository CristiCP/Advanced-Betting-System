// Configure byte acknowledgements for one subscription generation.
export interface StreamDeliveryOptions {
  maxInFlightBytes: number;
  onChunk(attempt: number, sequence: number, chunk: ArrayBuffer): void;
}
