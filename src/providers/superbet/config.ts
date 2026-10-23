import type { SuperbetOptions } from "./model/config.interfaces.js";

/**
 * @file Configures Superbet discovery, per-event SSE, and processing limits.
 */

export const superbetConfig: SuperbetOptions = {
  origin: "https://production-superbet-offer-ro.freetls.fastly.net",
  discoveryIntervalMs: 5 * 60_000,
  requestTimeoutMs: 10_000,
  retryDelayMs: 1_000,
  synchronizationTimeoutMs: 10_000,
  streamIdleTimeoutMs: 45_000,
  maxHttp1Connections: 256,
  maxHttp2Connections: 8,
  maxConcurrentSnapshots: 8,
  maxBufferedUpdates: 256,
  maxDecodedMessageBytes: 32 * 1024 * 1024,
  maxInFlightBytes: 256 * 1024,
};
