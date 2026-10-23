import type { TLSSocket } from "node:tls";

// Configure TLS connection establishment and cancellation.
export interface TlsConnectionOptions {
  origin: string;
  connectTimeoutMs: number;
  signal?: AbortSignal;
}

// Return the established connection and its HTTP protocol.
export interface TlsConnection {
  socket: TLSSocket;
  protocol: "h2" | "http/1.1";
}
