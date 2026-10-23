import { Http1Transport } from "./http1/http1.js";
import { Http2Pool } from "./http2/http2-pool.js";
import { connectTls } from "./tls.js";
import type {
  ManagedStreamingNetworkTransport,
  StreamingNetworkTransport,
  TransportOptions,
  TransportRequest,
  TransportResponse,
  TransportStream,
  TransportStreamOptions,
} from "../model/transport.interfaces.js";

/**
 * @file Shares protocol negotiation, reconnection, and transport shutdown per origin.
 */

export class HttpTransport implements StreamingNetworkTransport {
  private readonly options: TransportOptions;
  private readonly connectAbort = new AbortController();
  private readonly retirements = new Set<Promise<void>>();
  private transport: ManagedStreamingNetworkTransport | null = null;
  private pendingTransport: ManagedStreamingNetworkTransport | null = null;
  private connectPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private initialized = false;
  private closing = false;

  // Keep an independent copy of the transport configuration.
  constructor(options: TransportOptions) {
    this.options = { ...options };
  }

  // Share one connection attempt across callers and allow later retries.
  connect(): Promise<void> {
    if (this.closing) {
      return Promise.reject(new Error("HTTP transport is closing."));
    }

    if (this.connectPromise !== null) {
      return this.connectPromise;
    }

    if (this.transport?.isUsable()) {
      return Promise.resolve();
    }

    const attempt = this.initialize();
    this.connectPromise = attempt;

    // Release the attempt after either success or failure.
    const release = (): void => {
      if (this.connectPromise === attempt) {
        this.connectPromise = null;
      }
    };

    void attempt.then(release, release);
    return attempt;
  }

  // Retire the old transport and negotiate a replacement.
  private async initialize(): Promise<void> {
    const previous = this.transport;
    this.transport = null;

    if (previous !== null) {
      this.retire(previous);
    }

    const connection = await connectTls({
      origin: this.options.origin,
      connectTimeoutMs: this.options.connectTimeoutMs,
      signal: this.connectAbort.signal,
    });

    let candidate: ManagedStreamingNetworkTransport | null = null;

    try {
      this.connectAbort.signal.throwIfAborted();

      candidate =
        connection.protocol === "h2"
          ? new Http2Pool(this.options, connection)
          : new Http1Transport(this.options, connection);

      this.pendingTransport = candidate;
      await candidate.connect();
      this.connectAbort.signal.throwIfAborted();

      if (!candidate.isUsable()) {
        throw new Error("The new HTTP transport is already unavailable.");
      }

      this.transport = candidate;
      this.initialized = true;
    } catch (error) {
      // Release an unclaimed socket or a partially initialized transport.
      try {
        if (candidate === null) {
          connection.socket.destroy();
        } else {
          await candidate.close();
        }
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "HTTP transport initialization and cleanup failed.",
        );
      }

      throw error;
    } finally {
      this.pendingTransport = null;
    }
  }

  // Drain old requests without delaying the replacement connection.
  private retire(transport: ManagedStreamingNetworkTransport): void {
    const cleanup = transport
      .close()
      .catch((error: unknown) => {
        console.error("Retired HTTP transport cleanup failed:", error);
      })
      .finally(() => {
        this.retirements.delete(cleanup);
      });

    this.retirements.add(cleanup);
  }

  // Keep usable transports on the direct request path.
  request(options: TransportRequest): Promise<TransportResponse> {
    if (!this.initialized || this.closing) {
      return Promise.reject(
        new Error("Connect the HTTP transport before sending requests."),
      );
    }

    const transport = this.transport;

    if (transport?.isUsable()) {
      return transport.request(options);
    }

    return this.requestAfterReconnect(options);
  }

  // Delegate streaming directly while the negotiated transport remains usable.
  openStream(options: TransportStreamOptions): Promise<TransportStream> {
    if (!this.initialized || this.closing) {
      return Promise.reject(
        new Error("Connect the HTTP transport before opening streams."),
      );
    }

    if (
      !Number.isInteger(options.headersTimeoutMs) ||
      options.headersTimeoutMs <= 0 ||
      options.headersTimeoutMs > 2_147_483_647
    ) {
      return Promise.reject(new Error("Invalid HTTP stream headers timeout."));
    }

    const transport = this.transport;

    if (transport?.isUsable()) {
      return transport.openStream(options);
    }

    return this.openStreamAfterReconnect(options);
  }

  // Limit reconnection and headers together without timing out the live body.
  private async openStreamAfterReconnect(
    options: TransportStreamOptions,
  ): Promise<TransportStream> {
    options.signal?.throwIfAborted();

    const deadline = new AbortController();
    const signal =
      options.signal === undefined
        ? deadline.signal
        : AbortSignal.any([deadline.signal, options.signal]);
    const timer = setTimeout(() => {
      deadline.abort(
        new Error(
          `HTTP response headers timed out after ${options.headersTimeoutMs} ms.`,
        ),
      );
    }, options.headersTimeoutMs);

    try {
      await this.waitForConnection(signal);
      signal.throwIfAborted();

      const transport = this.transport;

      if (this.closing || transport === null || !transport.isUsable()) {
        throw new Error("HTTP transport is unavailable after reconnection.");
      }

      return await transport.openStream({ ...options, signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // Include reconnection waiting in this request's total deadline.
  private async requestAfterReconnect(
    options: TransportRequest,
  ): Promise<TransportResponse> {
    options.signal?.throwIfAborted();

    const deadline = new AbortController();
    const signal =
      options.signal === undefined
        ? deadline.signal
        : AbortSignal.any([deadline.signal, options.signal]);

    const timer = setTimeout(() => {
      deadline.abort(
        new Error(
          `HTTP request timed out after ${this.options.requestTimeoutMs} ms.`,
        ),
      );
    }, this.options.requestTimeoutMs);

    try {
      await this.waitForConnection(signal);
      signal.throwIfAborted();

      const transport = this.transport;

      if (this.closing || transport === null || !transport.isUsable()) {
        throw new Error("HTTP transport is unavailable after reconnection.");
      }

      return await transport.request({ ...options, signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // Cancel one caller's wait without cancelling the shared connection attempt.
  private waitForConnection(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();

    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        cleanup();
        reject(signal.reason);
      };

      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
      };

      signal.addEventListener("abort", onAbort, { once: true });

      void this.connect().then(
        () => {
          cleanup();
          resolve();
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  // Block new work and cancel any shared connection attempt.
  close(): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }

    this.closing = true;
    this.connectAbort.abort(new Error("HTTP transport is closing."));
    this.closePromise = this.shutdown();

    return this.closePromise;
  }

  // Close current and pending transports, then await all resource cleanup.
  private async shutdown(): Promise<void> {
    const owned = new Set(
      [this.transport, this.pendingTransport].filter(
        (transport) => transport !== null,
      ),
    );

    const results = await Promise.allSettled(
      [...owned].map((transport) => transport.close()),
    );

    await this.connectPromise?.catch(() => {});
    await Promise.all(this.retirements);

    this.transport = null;
    this.pendingTransport = null;

    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );

    if (errors.length > 0) {
      throw new AggregateError(errors, "HTTP transport shutdown failed.");
    }
  }
}
