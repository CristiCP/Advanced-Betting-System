import { createRequire } from "node:module";
import type { BetanoDiff } from "../model/state.interfaces.js";
import { isRecord } from "../processing/state.js";
import type { Lz4Decoder } from "../model/compression.interfaces.js";

/**
 * @file Decodes size-limited LZ4 batches outside the network worker.
 */

const require = createRequire(import.meta.url);
const lz4: Lz4Decoder = require("lz4js");

export function decodeDiffs(value: unknown, maxBytes: number): BetanoDiff[] {
  if (typeof value !== "string")
    throw new Error("Invalid compressed Betano message.");
  const compressed = Buffer.from(value, "base64");
  if (compressed.length < 7 || compressed.readUInt32LE(0) !== 0x184d2204)
    throw new Error("Invalid LZ4 frame.");
  const bound = lz4.decompressBound(compressed);
  if (!Number.isSafeInteger(bound) || bound <= 0 || bound > maxBytes)
    throw new Error("Decoded Betano batch exceeds its byte limit.");
  const decoded: unknown = JSON.parse(
    Buffer.from(lz4.decompress(compressed, bound)).toString("utf8"),
  );
  if (!Array.isArray(decoded)) throw new Error("Invalid Betano diff batch.");
  for (const diff of decoded) {
    if (!isRecord(diff) || !Number.isInteger(diff.type))
      throw new Error("Invalid Betano diff type.");
    if (diff.payload == null) diff.payload = {};
    if (
      ((diff.type as number) >= 200 && (diff.type as number) < 300) ||
      diff.type === 9999
    ) {
      diff.eventId ??= 0;
      diff.version ??= 0;
    }
    if (
      !Number.isSafeInteger(diff.eventId) ||
      !Number.isSafeInteger(diff.version) ||
      !isRecord(diff.payload)
    )
      throw new Error(
        `Invalid Betano event diff (type=${String(diff.type)}, event=${String(diff.eventId)}, version=${String(diff.version)}).`,
      );
  }
  return decoded as BetanoDiff[];
}
