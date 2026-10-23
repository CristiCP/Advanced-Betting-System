import type { NetworkWorkerData } from "./model/worker.interfaces.js";

/**
 * @file Configures the API origins managed by the network worker.
 */

// Use a test origin while integrating the networking components.
export const networkConfig: NetworkWorkerData = {
  transports: [
    {
      origin: "https://nodejs.org",
      connectTimeoutMs: 10_000,
      requestTimeoutMs: 10_000,
      maxHttp1Connections: 4,
      maxHttp2Connections: 8,
      reservedHttp2Streams: 1,
    },
  ],
};
