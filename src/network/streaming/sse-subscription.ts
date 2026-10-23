import { setTimeout as delay } from "node:timers/promises";
import type {
  SseSubscription,
  SseSubscriptionOptions,
} from "../model/sse-subscription.interfaces.js";
import type { TransportStream } from "../model/transport.interfaces.js";

/**
 * @file Supervises one SSE response without parsing or decompressing its body.
 */

export class ReconnectingSseSubscription implements SseSubscription {
  private readonly options: SseSubscriptionOptions;
  private readonly stopController = new AbortController();
  private readonly signal: AbortSignal;
  private runPromise: Promise<void> | null = null;
  private stream: TransportStream | null = null;
  private paused = false;
  private callbackFailed = false;
  private callbackFailure: unknown;

  // Snapshot headers and combine local and external cancellation.
  constructor(options: SseSubscriptionOptions) {
    for (const timeout of [options.headersTimeoutMs, options.retryDelayMs]) {
      if (
        !Number.isInteger(timeout) ||
        timeout <= 0 ||
        timeout > 2_147_483_647
      ) {
        throw new Error("Invalid SSE subscription timeout.");
      }
    }

    if (
      !options.request.path.startsWith("/") ||
      options.request.path.includes("#")
    ) {
      throw new Error("Expected an SSE request path without a URL fragment.");
    }

    const headers: Record<string, string> = { accept: "text/event-stream" };
    for (const [name, value] of Object.entries(options.request.headers ?? {})) {
      const key = name.toLowerCase();
      if (key.startsWith(":") || key === "host") {
        throw new Error(`Cannot override SSE routing header: ${name}`);
      }
      headers[key] = value;
    }

    this.signal =
      options.request.signal === undefined
        ? this.stopController.signal
        : AbortSignal.any([this.stopController.signal, options.request.signal]);
    this.options = {
      ...options,
      request: { ...options.request, headers, signal: this.signal },
    };
  }

  // Share one execution promise, including its final stop notification.
  run(): Promise<void> {
    this.runPromise ??= this.execute().finally(() =>
      this.options.onStopped?.(),
    );
    return this.runPromise;
  }

  // Consumer failures terminate the subscription instead of replaying data.
  private notify<T>(callback: () => T): T {
    try {
      return callback();
    } catch (error) {
      this.callbackFailed = true;
      this.callbackFailure = error;
      this.stopController.abort(error);
      throw error;
    }
  }

  // Keep one response active and retain pause state across reconnections.
  private async execute(): Promise<void> {
    let attempt = 0;

    while (!this.signal.aborted) {
      attempt++;
      let stream: TransportStream | null = null;
      let opened = false;

      try {
        stream = await this.options.transport.openStream({
          ...this.options.request,
          method: "GET",
          headersTimeoutMs: this.options.headersTimeoutMs,
          onChunk: (chunk) => {
            if (this.signal.aborted) {
              return false;
            }

            const accepted = this.notify(() =>
              this.options.onChunk(attempt, chunk),
            );
            if (!accepted) {
              this.paused = true;
            }
            return !this.paused;
          },
        });
        this.stream = stream;

        if (this.signal.aborted) {
          break;
        }

        const response = stream.response;

        // HTTP 204 explicitly ends an SSE subscription without reconnecting.
        if (response.statusCode === 204) {
          return;
        }

        const contentType = response.headers["content-type"];
        if (
          response.statusCode !== 200 ||
          typeof contentType !== "string" ||
          contentType.split(";", 1)[0]?.trim().toLowerCase() !==
            "text/event-stream"
        ) {
          throw new Error(
            `Invalid SSE response: status ${response.statusCode}, content-type ${String(contentType)}.`,
          );
        }

        opened = true;
        this.notify(() => this.options.onOpen(attempt, response));
        if (!this.paused && !this.signal.aborted) {
          stream.resume();
        }

        await stream.closed;
        if (this.callbackFailed) {
          throw this.callbackFailure;
        }
      } catch (error) {
        if (this.callbackFailed) {
          throw this.callbackFailure;
        }
        if (!this.signal.aborted) {
          this.notify(() => this.options.onError(attempt, error));
        }
      } finally {
        // A failed closed promise is already reported by the attempt handler.
        await stream?.close().catch(() => {});
        this.stream = null;
        if (opened && !this.callbackFailed) {
          this.notify(() => this.options.onEnd(attempt, this.signal.aborted));
        }
      }

      if (!this.signal.aborted) {
        try {
          await delay(this.options.retryDelayMs, undefined, {
            signal: this.signal,
          });
        } catch (error) {
          if (!this.signal.aborted) {
            throw error;
          }
        }
      }
    }
  }

  // Pause only this subscription, including a response opened later.
  pause(): void {
    this.paused = true;
    this.stream?.pause();
  }

  // Resume after the consumer releases enough capacity.
  resume(): void {
    this.paused = false;
    if (!this.signal.aborted) {
      this.stream?.resume();
    }
  }

  // Cancel opening, an active response, or the reconnect delay.
  async stop(): Promise<void> {
    this.stopController.abort();
    await this.runPromise;
  }
}
