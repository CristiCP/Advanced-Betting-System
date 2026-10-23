// Configure the API origin, deadlines, and connection pools.
export interface TransportOptions {
  engine?: "node" | "browser";
  origin: string;
  requestTimeoutMs: number;
  maxHttp1Connections: number;
  connectTimeoutMs: number;
  // Limit accepting HTTP/2 connections; draining connections finish separately.
  maxHttp2Connections?: number;
  // Keep capacity available for buffered requests when the peer limit permits.
  reservedHttp2Streams?: number;
}

// Define an outgoing HTTP request.
export interface TransportRequest {
  // Include the pathname and query string, without the origin.
  path: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}

// Define an HTTP response with its complete, unparsed body.
export interface TransportResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: ArrayBuffer;
}

// Define response metadata available before streamed body delivery.
export interface TransportStreamResponse extends Omit<
  TransportResponse,
  "body"
> {}

// Configure incremental delivery of an unparsed HTTP response body.
export interface TransportStreamOptions extends TransportRequest {
  // Limit opening and response-header waiting, without limiting stream lifetime.
  headersTimeoutMs: number;

  // The chunk owns transferable memory; return false to pause after delivery.
  onChunk(chunk: ArrayBuffer): boolean;
}

// Control one response stream independently of its shared connection.
export interface TransportStream {
  readonly response: TransportStreamResponse;

  // Resolve on normal completion or local cancellation; reject on failure.
  readonly closed: Promise<void>;

  pause(): void;
  resume(): void;

  // Cancel this stream and wait for its resources to be released.
  close(): Promise<void>;
}

// Define the shared lifecycle and request API for both HTTP versions.
export interface NetworkTransport {
  connect(): Promise<void>;
  request(options: TransportRequest): Promise<TransportResponse>;
  close(): Promise<void>;
}

// Expose whether the current HTTP session or pool accepts new requests.
export interface ManagedNetworkTransport extends NetworkTransport {
  isUsable(): boolean;
}

// Extend ordinary requests with incremental response-body delivery.
export interface StreamingNetworkTransport extends NetworkTransport {
  // Resolve after response headers with body delivery paused.
  openStream(options: TransportStreamOptions): Promise<TransportStream>;
}

// Combine streaming support with session or pool health checks.
export interface ManagedStreamingNetworkTransport
  extends ManagedNetworkTransport, StreamingNetworkTransport {}
