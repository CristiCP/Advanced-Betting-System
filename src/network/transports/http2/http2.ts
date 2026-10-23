import { connect as createSession, constants } from "node:http2";
import type {
  ClientHttp2Session,
  ClientHttp2Stream,
  OutgoingHttpHeaders,
} from "node:http2";
import { openHttp2Stream } from "./http2-stream.js";
import { connectTls } from "../tls.js";
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
 * @file Sends buffered requests and independent streams over one HTTP/2 session.
 */

export class Http2Transport implements ManagedStreamingNetworkTransport {
  private readonly options: TransportOptions;
  private initialConnection: TlsConnection | null;
  private readonly connectAbort = new AbortController();
  private readonly streamAborts = new Set<AbortController>();
  private readonly requestStreams = new Set<ClientHttp2Stream>();
  private readonly activeStreams = new Set<ClientHttp2Stream>();
  private readonly stateListeners = new Set<() => void>();
  private resolveRequestsDrained: (() => void) | null = null;

  private session: ClientHttp2Session | null = null;
  private sessionClosed: Promise<void> | null = null;
  private connectPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private failure: Error | null = null;
  private streamLimit = 0;
  private ready = false;
  private closing = false;

  // Configure the transport and optionally adopt an existing TLS connection.
  constructor(
    options: TransportOptions,
    connection: TlsConnection | null = null,
  ) {
    for (const timeout of [
      options.connectTimeoutMs,
      options.requestTimeoutMs,
    ]) {
      if (
        !Number.isInteger(timeout) ||
        timeout <= 0 ||
        timeout > 2_147_483_647
      ) {
        throw new Error("Invalid HTTP/2 transport timeout.");
      }
    }

    this.options = { ...options };
    this.initialConnection = connection;
  }

  // Check whether the current session can accept new requests.
  isUsable(): boolean {
    const session = this.session;

    return (
      this.ready &&
      !this.closing &&
      this.failure === null &&
      session !== null &&
      !session.closed &&
      !session.destroyed
    );
  }

  // Read the peer's current limit instead of assuming a fixed stream count.
  getStreamLimit(): number {
    return this.streamLimit;
  }

  // Include pending native streams until their close event releases capacity.
  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }

  // Notify the pool when admission limits, session health, or occupancy change.
  onStateChange(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private notifyStateChange(): void {
    for (const listener of this.stateListeners) {
      listener();
    }
  }

  // Release a slot only after native cleanup, including failed opening attempts.
  private trackStream(stream: ClientHttp2Stream): void {
    this.activeStreams.add(stream);
    stream.once("close", () => {
      this.activeStreams.delete(stream);
      this.notifyStateChange();
    });
  }

  // Share one connection attempt between concurrent callers.
  connect(): Promise<void> {
    if (this.closing) {
      return Promise.reject(new Error("HTTP/2 transport is closing."));
    }

    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }

    this.connectPromise ??= this.openSession();
    return this.connectPromise;
  }

  // Establish the session using the existing or newly negotiated TLS socket.
  private async openSession(): Promise<void> {
    const connection =
      this.initialConnection ??
      (await connectTls({
        origin: this.options.origin,
        connectTimeoutMs: this.options.connectTimeoutMs,
        signal: this.connectAbort.signal,
      }));

    this.initialConnection = null;

    if (this.closing || connection.protocol !== "h2") {
      connection.socket.destroy();

      throw new Error(
        this.closing
          ? "HTTP/2 connection cancelled."
          : "The server did not negotiate HTTP/2.",
      );
    }

    try {
      const session = createSession(this.options.origin, {
        createConnection: () => connection.socket,
        settings: { enablePush: false },
      });

      this.session = session;

      // Keep session failures available to subsequent callers.
      session.on("error", (error: Error) => {
        this.failure = error;
        this.notifyStateChange();
      });

      // Stop accepting new requests when the server ends the session.
      session.on("goaway", (code: number) => {
        this.failure = new Error(`HTTP/2 server sent GOAWAY. Code: ${code}`);
        this.notifyStateChange();
      });

      session.on("remoteSettings", (settings) => {
        this.streamLimit = settings.maxConcurrentStreams ?? 0;
        this.notifyStateChange();
      });

      // Track actual termination for shutdown.
      this.sessionClosed = new Promise<void>((resolve) => {
        session.once("close", () => {
          this.ready = false;
          this.failure ??= new Error("HTTP/2 session closed.");
          this.notifyStateChange();
          resolve();
        });
      });

      await this.waitForSettings(session);
      this.ready = true;
      this.notifyStateChange();
    } catch (error) {
      if (this.session !== null) {
        this.session.destroy();
      } else {
        connection.socket.destroy();
      }

      throw error;
    }
  }

  // Wait for the server's initial settings, including its stream limit.
  private waitForSettings(session: ClientHttp2Session): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.destroy(new Error("HTTP/2 settings negotiation timed out."));
      }, this.options.connectTimeoutMs);

      function cleanup(): void {
        clearTimeout(timer);
        session.off("remoteSettings", onReady);
        session.off("error", onError);
        session.off("close", onClose);
      }

      function onReady(): void {
        cleanup();
        resolve();
      }

      function onError(error: Error): void {
        cleanup();
        reject(error);
      }

      function onClose(): void {
        cleanup();
        reject(new Error("HTTP/2 session closed during initialization."));
      }

      session.once("remoteSettings", onReady);
      session.once("error", onError);
      session.once("close", onClose);
    });
  }

  // Send one request and resolve after its complete response body is read.
  async request(options: TransportRequest): Promise<TransportResponse> {
    const session = this.session;

    if (this.failure !== null) {
      throw this.failure;
    }

    if (session === null || !this.isUsable()) {
      throw new Error("Connect the HTTP/2 transport before sending requests.");
    }

    options.signal?.throwIfAborted();
    const headers = this.createHeaders(options);

    const stream = session.request(headers, {
      endStream: options.body === undefined,
      signal: options.signal,
    });

    this.requestStreams.add(stream);
    this.trackStream(stream);

    return new Promise<TransportResponse>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      const responseHeaders: TransportResponse["headers"] = {};
      let statusCode: number | undefined;
      let byteLength = 0;
      let settled = false;
      let responseEnded = false;

      // Include time spent waiting for an available HTTP/2 stream.
      const timer = setTimeout(() => {
        fail(
          new Error(
            `HTTP/2 request timed out after ${this.options.requestTimeoutMs} ms.`,
          ),
        );
      }, this.options.requestTimeoutMs);

      // Cancel only this stream when its request fails.
      function fail(error: unknown): void {
        if (settled) return;

        settled = true;
        clearTimeout(timer);
        chunks.length = 0;
        reject(error);

        if (!stream.closed && !stream.destroyed) {
          stream.close(constants.NGHTTP2_CANCEL);
        }
      }

      // Extract regular headers separately from the HTTP/2 status.
      stream.once("response", (received) => {
        statusCode = received[":status"];

        for (const [name, value] of Object.entries(received)) {
          if (
            !name.startsWith(":") &&
            (typeof value === "string" || Array.isArray(value))
          ) {
            responseHeaders[name] = value;
          }
        }
      });

      // Collect raw bytes without parsing or decompressing them.
      stream.on("data", (chunk: Uint8Array) => {
        if (!settled) {
          chunks.push(chunk);
          byteLength += chunk.byteLength;
        }
      });

      // Record that the response body has ended.
      stream.once("end", () => {
        responseEnded = true;
      });

      // Confirm stream completion before producing a transferable body.
      stream.once("close", () => {
        this.requestStreams.delete(stream);

        if (this.requestStreams.size === 0) {
          this.resolveRequestsDrained?.();
          this.resolveRequestsDrained = null;
        }

        if (settled) return;

        if (
          !responseEnded ||
          statusCode === undefined ||
          stream.rstCode !== constants.NGHTTP2_NO_ERROR
        ) {
          fail(
            new Error("HTTP/2 response ended without completing successfully."),
          );
          return;
        }

        try {
          const body = new ArrayBuffer(byteLength);
          const bytes = new Uint8Array(body);
          let offset = 0;

          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }

          settled = true;
          clearTimeout(timer);
          chunks.length = 0;

          resolve({
            statusCode,
            headers: responseHeaders,
            body,
          });
        } catch (error) {
          fail(error);
        }
      });

      // Reject resets, cancellations, and aborted responses.
      stream.once("error", fail);
      stream.once("aborted", () => {
        fail(new Error("HTTP/2 response was aborted."));
      });

      // Finish the outgoing request, with an optional body.
      try {
        stream.end(options.body);
      } catch (error) {
        fail(error);
      }
    });
  }

  // Open a paused response stream with cancellation scoped to this subscription.
  async openStream(options: TransportStreamOptions): Promise<TransportStream> {
    const session = this.session;

    if (this.failure !== null) {
      throw this.failure;
    }

    if (session === null || !this.isUsable()) {
      throw new Error("Connect the HTTP/2 transport before opening streams.");
    }

    options.signal?.throwIfAborted();
    const headers = this.createHeaders(options);
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
      const stream = await openHttp2Stream({
        session,
        headers,
        request: { ...options, signal },
        onStream: (nativeStream) => this.trackStream(nativeStream),
      });

      void stream.closed.then(release, release);
      return stream;
    } catch (error) {
      release();
      throw error;
    }
  }

  // Validate paths and keep routing tied to the configured origin.
  private createHeaders(options: TransportRequest): OutgoingHttpHeaders {
    if (!options.path.startsWith("/") || options.path.includes("#")) {
      throw new Error("Expected a request path without a URL fragment.");
    }

    const headers: OutgoingHttpHeaders = {
      ":method": options.method,
      ":path": options.path,
    };

    for (const [name, value] of Object.entries(options.headers ?? {})) {
      const key = name.toLowerCase();

      if (key.startsWith(":") || key === "host") {
        throw new Error(`Cannot override HTTP/2 routing header: ${name}`);
      }

      headers[key] = value;
    }

    return headers;
  }

  // Stop subscriptions and share one transport shutdown operation.
  close(): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }

    this.closing = true;
    const reason = new Error("HTTP/2 transport is closing.");
    this.connectAbort.abort(reason);

    for (const abort of this.streamAborts) {
      abort.abort(reason);
    }

    if (!this.ready) {
      this.session?.destroy();
    }

    this.closePromise = this.shutdown();
    return this.closePromise;
  }

  // Wait for buffered requests, including requests queued by the HTTP/2 session.
  private waitForRequests(): Promise<void> {
    if (this.requestStreams.size === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.resolveRequestsDrained = resolve;
    });
  }

  // Drain active requests, with a deadline for session termination.
  private async shutdown(): Promise<void> {
    this.initialConnection?.socket.destroy();
    this.initialConnection = null;

    // Let pending initialization finish releasing its resources.
    await this.connectPromise?.catch(() => {});

    const session = this.session;

    if (session === null) {
      return;
    }

    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      session.destroy();
    }, this.options.requestTimeoutMs);

    try {
      // Let queued requests finish before GOAWAY stops new stream admission.
      await this.waitForRequests();

      if (!session.destroyed) {
        session.close();
      }

      await this.sessionClosed;
    } finally {
      clearTimeout(timer);
    }

    if (timedOut) {
      throw new Error("HTTP/2 shutdown timed out.");
    }
  }
}
