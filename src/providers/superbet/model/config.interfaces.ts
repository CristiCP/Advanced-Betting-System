export interface SuperbetOptions {
  origin: string;
  discoveryIntervalMs: number;
  requestTimeoutMs: number;
  retryDelayMs: number;
  synchronizationTimeoutMs: number;
  streamIdleTimeoutMs: number;
  maxHttp1Connections: number;
  maxHttp2Connections: number;
  maxConcurrentSnapshots: number;
  maxBufferedUpdates: number;
  maxDecodedMessageBytes: number;
  maxInFlightBytes: number;
}
