import { createSession, WebSocket } from "wreq-js";
import type { Session } from "wreq-js";
import type {
  NetworkTransport,
  TransportOptions,
  TransportRequest,
  TransportResponse,
} from "../model/transport.interfaces.js";

/**
 * @file Sends HTTP requests and opens sockets with one native browser profile.
 */

export class BrowserTransport implements NetworkTransport {
  private session: Session | null = null;
  private connecting: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private readonly abort = new AbortController();

  constructor(private readonly options: TransportOptions) {
    if (new URL(options.origin).protocol !== "https:") {
      throw new Error("Browser transports require an HTTPS origin.");
    }
  }

  // Initialize one reusable native connection pool without opening a browser.
  connect(): Promise<void> {
    if (this.abort.signal.aborted)
      return Promise.reject(new Error("Transport is closed."));
    this.connecting ??= (async () => {
      this.session = await createSession({
        browser: "chrome_149",
        os: "windows",
        timeout: this.options.requestTimeoutMs,
      });
      if (this.abort.signal.aborted) await this.session.close();
    })();
    return this.connecting;
  }

  // Restrict requests to the configured origin and cancel outstanding bodies on shutdown.
  async request(options: TransportRequest): Promise<TransportResponse> {
    await this.connect();
    const url = new URL(options.path, this.options.origin);
    if (
      url.origin !== new URL(this.options.origin).origin ||
      !options.path.startsWith("/") ||
      options.path.startsWith("//")
    ) {
      throw new Error("Request path must stay on the configured origin.");
    }
    const signal = AbortSignal.any([
      this.abort.signal,
      AbortSignal.timeout(this.options.requestTimeoutMs),
      ...(options.signal === undefined ? [] : [options.signal]),
    ]);
    signal.throwIfAborted();
    const response = await this.session!.fetch(url, {
      method: options.method,
      headers: options.headers ?? {},
      ...(options.body === undefined ? {} : { body: options.body }),
      signal,
      redirect: "manual",
    });
    const body = await response.arrayBuffer();
    signal.throwIfAborted();
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers),
      body,
    };
  }

  // Return a connecting socket so callers can cancel its opening handshake.
  openSocket(
    path: string,
    headers: Record<string, string>,
    maxMessageBytes: number,
  ): WebSocket {
    if (this.session === null || this.abort.signal.aborted)
      throw new Error("Transport is not ready.");
    const url = new URL(path, this.options.origin);
    if (
      url.origin !== new URL(this.options.origin).origin ||
      !path.startsWith("/") ||
      path.startsWith("//")
    ) {
      throw new Error("WebSocket path must stay on the configured origin.");
    }
    const cookies = Object.entries(this.session.getCookies(url))
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
    url.protocol = "wss:";
    return new WebSocket(url, {
      browser: "chrome_149",
      os: "windows",
      headers: {
        origin: this.options.origin,
        ...(cookies ? { cookie: cookies } : {}),
        ...headers,
      },
      maxFrameSize: maxMessageBytes,
      maxMessageSize: maxMessageBytes,
    });
  }

  // Share cleanup and prevent a late initialization from leaving a native pool alive.
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.abort.abort();
      await this.connecting?.catch(() => {});
      await this.session?.close();
      this.session = null;
    })();
    return this.closing;
  }
}
