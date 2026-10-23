export interface BetanoOptions {
  origin: string;
  discoveryIntervalMs: number;
  requestTimeoutMs: number;
  retryDelayMs: number;
  eventsPerSocket: number;
  maxConcurrentSnapshots: number;
  maxBufferedDiffs: number;
  maxDecodedMessageBytes: number;
  maxInFlightBytes: number;
  heartbeatMs: number;
  serverTimeoutMs: number;
}
