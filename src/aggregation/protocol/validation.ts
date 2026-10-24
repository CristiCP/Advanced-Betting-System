import type {
  AggregationBatchMessage,
  AggregationControlMessage,
  AggregationOutboxOptions,
  AggregationProvider,
} from "../model/wire.interfaces.js";
import { fullStateBytes } from "./wire.js";

/**
 * @file Guards every structured message crossing an aggregation port.
 */

export const maxWireCounter = 0xffff_ffff;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCounter = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) > 0 &&
  (value as number) <= maxWireCounter;

const isBounded = (value: unknown, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= max;

export const isProvider = (value: unknown): value is AggregationProvider =>
  value === "superbet" || value === "betano";

// The batch limit must hold a complete re-emission twice, so a reset can never overflow again.
export function isOutboxOptions(
  value: unknown,
): value is AggregationOutboxOptions {
  return (
    isRecord(value) &&
    isBounded(value.batchWindowMs, 1_000) &&
    isBounded(value.maxEvents, 1 << 16) &&
    isBounded(value.maxLines, 1 << 22) &&
    isBounded(value.maxBatchBytes, 1 << 30) &&
    value.maxBatchBytes >=
      2 * fullStateBytes(value.maxEvents, value.maxLines)
  );
}

export function isBatchMessage(
  value: unknown,
): value is AggregationBatchMessage {
  return (
    isRecord(value) &&
    value.type === "batch" &&
    isCounter(value.generation) &&
    isCounter(value.sequence) &&
    value.buffer instanceof ArrayBuffer
  );
}

export function isControlMessage(
  value: unknown,
): value is AggregationControlMessage {
  if (!isRecord(value) || !isCounter(value.generation)) return false;
  switch (value.type) {
    case "attach":
      return isOutboxOptions(value.options);
    case "ack":
      return isCounter(value.sequence) && value.buffer instanceof ArrayBuffer;
    case "resync":
      return isCounter(value.sequence);
    default:
      return false;
  }
}
