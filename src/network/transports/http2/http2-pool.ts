import { Http2Transport } from "./http2.js";
import type {
  Http2PoolConnection,
  Http2PoolJob,
} from "../../model/http2-pool.interfaces.js";
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
 * @file Shares HTTP/2 sessions by peer capacity while preserving active streams.
 */

export class Http2Pool implements ManagedStreamingNetworkTransport {
  private readonly options: TransportOptions;
  private readonly maxConnections: number;
  private readonly reservedStreams: number;
  private readonly connections = new Set<Http2PoolConnection>();
  private readonly jobs = new Set<Http2PoolJob>();
  private readonly retirements = new Set<Promise<void>>();
  private readonly cleanupErrors: unknown[] = [];
  private initialConnection: TlsConnection | null;
  private connectPromise: Promise<void> | null = null;
  private pendingConnection: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private initialized = false;
  private closing = false;
  private dispatchScheduled = false;

  // Keep optional pool settings compatible with existing transport callers.
  constructor(
    options: TransportOptions,
    connection: TlsConnection | null = null,
  ) {
    this.maxConnections = options.maxHttp2Connections ?? 8;
    this.reservedStreams = options.reservedHttp2Streams ?? 1;

    if (!Number.isInteger(this.maxConnections) || this.maxConnections <= 0) {
      throw new Error("HTTP/2 pool size must be a positive integer.");
    }

    if (!Number.isInteger(this.reservedStreams) || this.reservedStreams < 0) {
      throw new Error(
        "HTTP/2 reserved stream count must be a non-negative integer.",
      );
    }

    this.options = { ...options };
    this.initialConnection = connection;
  }

  // Keep replacement sessions inside this pool when an individual session fails.
  isUsable(): boolean {
    return this.initialized && !this.closing;
  }

  // Adopt the negotiated socket once and share initial settings negotiation.
  connect(): Promise<void> {
    if (this.closing) {
      return Promise.reject(new Error("HTTP/2 pool is closing."));
    }

    if (this.connectPromise !== null) {
      return this.connectPromise;
    }

    const attempt = this.openConnection();
    this.pendingConnection = attempt;
    this.connectPromise = attempt.then(() => {
      this.initialized = true;
    });

    void attempt.then(
      () => {
        this.pendingConnection = null;
        this.scheduleDispatch();
      },
      () => {
        this.pendingConnection = null;
      },
    );

    return this.connectPromise;
  }

  // Register the session before awaiting settings so shutdown owns pending TLS.
  private async openConnection(): Promise<void> {
    const transport = new Http2Transport(this.options, this.initialConnection);
    this.initialConnection = null;
    const entry: Http2PoolConnection = {
      transport,
      ready: false,
      draining: false,
      unsubscribe: transport.onStateChange(() => this.scheduleDispatch()),
    };
    this.connections.add(entry);

    try {
      await transport.connect();

      if (this.closing || !transport.isUsable()) {
        throw new Error(
          "HTTP/2 pool connection is unavailable after negotiation.",
        );
      }

      entry.ready = true;
    } catch (error) {
      this.connections.delete(entry);
      entry.unsubscribe();

      try {
        await transport.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "HTTP/2 connection cleanup failed.",
        );
      }

      throw error;
    }
  }

  // Include admission waiting and response reading in the buffered deadline.
  async request(options: TransportRequest): Promise<TransportResponse> {
    this.validateRequest(options);
    options.signal?.throwIfAborted();
    const deadline = new AbortController();
    const signal =
      options.signal === undefined
        ? deadline.signal
        : AbortSignal.any([deadline.signal, options.signal]);
    const timer = setTimeout(() => {
      deadline.abort(
        new Error(
          `HTTP/2 request timed out after ${this.options.requestTimeoutMs} ms.`,
        ),
      );
    }, this.options.requestTimeoutMs);

    try {
      return await this.dispatch("request", signal, (transport) =>
        transport.request({ ...options, signal }),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // Limit admission and headers while leaving the response body open-ended.
  async openStream(options: TransportStreamOptions): Promise<TransportStream> {
    this.validateRequest(options);

    if (
      !Number.isInteger(options.headersTimeoutMs) ||
      options.headersTimeoutMs <= 0 ||
      options.headersTimeoutMs > 2_147_483_647
    ) {
      throw new Error("Invalid HTTP/2 stream headers timeout.");
    }

    options.signal?.throwIfAborted();
    const deadline = new AbortController();
    const signal =
      options.signal === undefined
        ? deadline.signal
        : AbortSignal.any([deadline.signal, options.signal]);
    const timer = setTimeout(() => {
      deadline.abort(
        new Error(
          `HTTP/2 response headers timed out after ${options.headersTimeoutMs} ms.`,
        ),
      );
    }, options.headersTimeoutMs);

    try {
      return await this.dispatch("stream", signal, (transport) =>
        transport.openStream({ ...options, signal }),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // Reject invalid routing before it can cause an unnecessary connection.
  private validateRequest(options: TransportRequest): void {
    if (!this.isUsable()) {
      throw new Error("Connect the HTTP/2 pool before sending requests.");
    }

    if (!options.path.startsWith("/") || options.path.includes("#")) {
      throw new Error("Expected a request path without a URL fragment.");
    }

    for (const name of Object.keys(options.headers ?? {})) {
      if (name.startsWith(":") || name.toLowerCase() === "host") {
        throw new Error(`Cannot override HTTP/2 routing header: ${name}`);
      }
    }
  }

  // Remove cancelled jobs immediately without cancelling shared TLS negotiation.
  private dispatch<T>(
    kind: Http2PoolJob["kind"],
    signal: AbortSignal,
    operation: (transport: Http2Transport) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();

    return new Promise<T>((resolve, reject) => {
      const cleanup = (): void => {
        this.jobs.delete(job);
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = (): void => {
        cleanup();
        reject(signal.reason);
      };
      const job: Http2PoolJob = {
        kind,
        start: (transport) => {
          cleanup();
          try {
            signal.throwIfAborted();
            void operation(transport).then(resolve, reject);
          } catch (error) {
            reject(error);
          }
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };

      signal.addEventListener("abort", onAbort, { once: true });
      this.jobs.add(job);
      this.scheduleDispatch();
    });
  }

  // Coalesce native lifecycle notifications into one admission pass.
  private scheduleDispatch(): void {
    if (this.closing || this.dispatchScheduled) {
      return;
    }

    this.dispatchScheduled = true;
    queueMicrotask(() => {
      this.dispatchScheduled = false;
      this.flush();
    });
  }

  // Preserve reserved REST slots and avoid blocking REST behind SSE jobs.
  private findConnection(
    kind: Http2PoolJob["kind"],
  ): Http2PoolConnection | undefined {
    for (const entry of this.connections) {
      const transport = entry.transport;

      if (!entry.ready || entry.draining || !transport.isUsable()) {
        continue;
      }

      const limit = transport.getStreamLimit();
      const reserve =
        kind === "stream"
          ? Math.min(this.reservedStreams, Math.max(0, limit - 1))
          : 0;

      if (transport.getActiveStreamCount() < limit - reserve) {
        return entry;
      }
    }
  }

  // Fill existing capacity first, then share one new connection attempt.
  private flush(): void {
    if (this.closing || !this.initialized) {
      return;
    }

    for (const entry of this.connections) {
      if (entry.ready && !entry.transport.isUsable()) {
        entry.draining = true;

        if (entry.transport.getActiveStreamCount() === 0) {
          this.retire(entry);
        }
      }
    }

    for (const job of this.jobs) {
      const entry = this.findConnection(job.kind);

      if (entry !== undefined) {
        // Native stream registration happens synchronously before the next job.
        job.start(entry.transport);
      }
    }

    const accepting = [...this.connections].filter(
      (entry) => !entry.draining,
    ).length;

    if (
      this.jobs.size === 0 ||
      this.pendingConnection !== null ||
      accepting >= this.maxConnections
    ) {
      return;
    }

    const attempt = this.openConnection();
    this.pendingConnection = attempt;
    void attempt.then(
      () => {
        this.pendingConnection = null;
        this.scheduleDispatch();
      },
      (error: unknown) => {
        this.pendingConnection = null;
        for (const job of this.jobs) {
          job.reject(error);
        }
      },
    );
  }

  // Close unavailable sessions only after their existing streams finish.
  private retire(entry: Http2PoolConnection): void {
    this.connections.delete(entry);
    entry.unsubscribe();
    const cleanup = entry.transport
      .close()
      .catch((error: unknown) => {
        this.cleanupErrors.push(error);
      })
      .finally(() => {
        this.retirements.delete(cleanup);
      });
    this.retirements.add(cleanup);
  }

  // Cancel queued and active subscriptions while buffered requests drain.
  close(): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }

    this.closing = true;
    const reason = new Error("HTTP/2 pool is closing.");
    for (const job of this.jobs) {
      job.reject(reason);
    }

    this.initialConnection?.socket.destroy();
    this.initialConnection = null;
    this.closePromise = this.shutdown();
    return this.closePromise;
  }

  // Await every owned session, including pending negotiation and retirement.
  private async shutdown(): Promise<void> {
    const owned = [...this.connections];
    for (const entry of owned) {
      entry.unsubscribe();
    }

    const results = await Promise.allSettled(
      owned.map((entry) => entry.transport.close()),
    );
    await this.pendingConnection?.catch(() => {});
    await Promise.all(this.retirements);
    this.connections.clear();
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    errors.push(...this.cleanupErrors);

    if (errors.length > 0) {
      throw new AggregateError(errors, "HTTP/2 pool shutdown failed.");
    }
  }
}
