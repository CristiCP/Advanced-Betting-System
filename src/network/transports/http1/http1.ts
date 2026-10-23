import { Pool, buildConnector } from "undici";
import type { TLSSocket } from "node:tls";
import { openHttp1Stream } from "./http1-stream.js";
import type { TlsConnection } from "../../model/tls.interfaces.js";
import type {
  ManagedStreamingNetworkTransport,
  TransportOptions,
  TransportRequest,
  TransportResponse,
  TransportStream,
  TransportStreamOptions,
} from "../../model/transport.interfaces.js";

/**
 * @file Sends buffered requests and streams through an HTTP/1.1 connection pool.
 */

export class Http1Transport implements ManagedStreamingNetworkTransport {
  private readonly options: TransportOptions;
  private readonly streamAborts = new Set<AbortController>();
  private initialSocket: TLSSocket | null;
  private pool: Pool | null = null;
  private closePromise: Promise<void> | null = null;
  private closing = false;

  // Discard an unused socket if it fails before the first request.
  private readonly onInitialFailure = (): void => {
    this.takeInitialSocket()?.destroy();
  };

  // Adopt the HTTP/1.1 connection selected during TLS negotiation.
  constructor(options: TransportOptions, connection: TlsConnection) {
    for (const timeout of [
      options.connectTimeoutMs,
      options.requestTimeoutMs,
    ]) {
      if (
        !Number.isInteger(timeout) ||
        timeout <= 0 ||
        timeout > 2_147_483_647
      ) {
        throw new Error("Invalid HTTP/1.1 transport timeout.");
      }
    }

    if (
      !Number.isInteger(options.maxHttp1Connections) ||
      options.maxHttp1Connections <= 0
    ) {
      throw new Error("HTTP/1.1 pool size must be a positive integer.");
    }

    const url = new URL(options.origin);

    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error("Expected an HTTPS origin.");
    }

    if (connection.protocol !== "http/1.1") {
      throw new Error("Expected an HTTP/1.1 TLS connection.");
    }

    this.options = { ...options, origin: url.origin };
    this.initialSocket = connection.socket;

    this.initialSocket.once("error", this.onInitialFailure);
    this.initialSocket.once("close", this.onInitialFailure);
  }

  // Check whether the pool can accept or queue new requests.
  isUsable(): boolean {
    const pool = this.pool;

    return !this.closing && pool !== null && !pool.closed && !pool.destroyed;
  }

  // Initialize the pool around the already established TLS connection.
  async connect(): Promise<void> {
    if (this.closing) {
      throw new Error("HTTP/1.1 transport is closing.");
    }

    if (this.pool !== null) {
      return;
    }

    const openConnection = buildConnector({
      allowH2: false,
      timeout: this.options.connectTimeoutMs,
    });

    this.pool = new Pool(this.options.origin, {
      connections: this.options.maxHttp1Connections,
      pipelining: 1,
      allowH2: false,
      headersTimeout: this.options.requestTimeoutMs,
      bodyTimeout: this.options.requestTimeoutMs,

      // Reuse the negotiated socket once, then open connections as needed.
      connect: (options, callback) => {
        // Avoid reentrant dispatch when handing over an existing socket.
        queueMicrotask(() => {
          const socket = this.takeInitialSocket();

          if (
            socket !== null &&
            !socket.destroyed &&
            socket.readable &&
            socket.writable
          ) {
            socket.setNoDelay(true);
            socket.setKeepAlive(true, 60_000);

            callback(null, socket);
            return;
          }

          socket?.destroy();
          openConnection(options, callback);
        });
      },
    });
  }

  // Transfer ownership of the initial socket to the pool.
  private takeInitialSocket(): TLSSocket | null {
    const socket = this.initialSocket;
    this.initialSocket = null;

    socket?.off("error", this.onInitialFailure);
    socket?.off("close", this.onInitialFailure);

    return socket;
  }

  // Read the complete response with one deadline covering queueing and I/O.
  async request(options: TransportRequest): Promise<TransportResponse> {
    const pool = this.pool;

    if (pool === null || !this.isUsable()) {
      throw new Error(
        "Connect the HTTP/1.1 transport before sending requests.",
      );
    }

    this.validateRequest(options);
    options.signal?.throwIfAborted();

    const deadline = new AbortController();

    const signal =
      options.signal === undefined
        ? deadline.signal
        : AbortSignal.any([deadline.signal, options.signal]);

    // Enforce a total deadline, including time in the pool queue.
    const timer = setTimeout(() => {
      deadline.abort(
        new Error(
          `HTTP/1.1 request timed out after ${this.options.requestTimeoutMs} ms.`,
        ),
      );
    }, this.options.requestTimeoutMs);

    try {
      const response = await pool.request({
        path: options.path,
        method: options.method,
        headers: options.headers ?? {},
        body: options.body ?? null,
        signal,
      });

      // Keep the body raw for transfer and processing outside networking.
      const body = await response.body.arrayBuffer();

      return {
        statusCode: response.statusCode,
        headers: response.headers,
        body,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // Track pending and active streams so shutdown can cancel persistent work.
  async openStream(options: TransportStreamOptions): Promise<TransportStream> {
    const pool = this.pool;

    if (pool === null || !this.isUsable()) {
      throw new Error("Connect the HTTP/1.1 transport before opening streams.");
    }

    this.validateRequest(options);
    options.signal?.throwIfAborted();

    const abort = new AbortController();
    const signal =
      options.signal === undefined
        ? abort.signal
        : AbortSignal.any([abort.signal, options.signal]);
    this.streamAborts.add(abort);

    const release = (): void => {
      this.streamAborts.delete(abort);
    };

    try {
      const stream = await openHttp1Stream({
        pool,
        request: { ...options, signal },
      });
      void stream.closed.then(release, release);
      return stream;
    } catch (error) {
      release();
      throw error;
    }
  }

  // Keep both request modes tied to the configured origin.
  private validateRequest(options: TransportRequest): void {
    if (!options.path.startsWith("/") || options.path.includes("#")) {
      throw new Error("Expected a request path without a URL fragment.");
    }

    for (const name of Object.keys(options.headers ?? {})) {
      if (name.startsWith(":") || name.toLowerCase() === "host") {
        throw new Error(`Cannot override HTTP/1.1 routing header: ${name}`);
      }
    }
  }

  // Reject new work, cancel streams, and share one shutdown operation.
  close(): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }

    this.closing = true;

    for (const abort of this.streamAborts) {
      abort.abort(new Error("HTTP/1.1 transport is closing."));
    }

    this.closePromise = this.shutdown();

    return this.closePromise;
  }

  // Close unused and pooled connections after draining active requests.
  private async shutdown(): Promise<void> {
    this.takeInitialSocket()?.destroy();

    const pool = this.pool;

    if (pool === null) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        pool.close(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("HTTP/1.1 shutdown timed out."));
          }, this.options.requestTimeoutMs);
        }),
      ]);
    } catch (error) {
      // Force cleanup when graceful shutdown fails or exceeds its deadline.
      await pool.destroy().catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
