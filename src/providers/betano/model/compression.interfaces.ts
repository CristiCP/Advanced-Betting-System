export interface Lz4Decoder {
  decompressBound(input: Uint8Array): number;
  decompress(input: Uint8Array, maxSize?: number): Uint8Array;
}
