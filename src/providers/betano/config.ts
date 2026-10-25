import type { BetanoOptions } from "./model/config.interfaces.js";

/**
 * @file Configures Betano discovery, shared sockets, and processing limits.
 */

export const betanoConfig: BetanoOptions = {
  origin: "https://ro.betano.com",
  discoveryIntervalMs: 5 * 60_000,
  requestTimeoutMs: 10_000,
  retryDelayMs: 1_000,
  eventsPerSocket: 50,
  // Split repeatedly failing groups; retry isolated events without disturbing their peers.
  socketFailureThreshold: 2,
  socketStableMs: 60_000,
  isolatedRetryDelayMs: 30_000,
  maxConcurrentSnapshots: 8,
  maxBufferedDiffs: 256,
  maxDecodedMessageBytes: 32 * 1024 * 1024,
  maxInFlightBytes: 1024 * 1024,
  heartbeatMs: 15_000,
  serverTimeoutMs: 45_000,
};
