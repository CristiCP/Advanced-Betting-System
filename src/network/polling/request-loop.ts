import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type {
  RequestLoop,
  RequestLoopOptions,
} from "../model/request-loop.interfaces.js";
import type {
  TransportRequest,
  TransportResponse,
} from "../model/transport.interfaces.js";

/**
 * @file Repeats independent requests with optional intervals and cancellation.
 */

export class ContinuousRequestLoop implements RequestLoop {
  private readonly options: RequestLoopOptions;
  private readonly intervalMs: number;
  private readonly stopController = new AbortController();
  private readonly signal: AbortSignal;
  private runPromise: Promise<void> | null = null;

  // Snapshot request settings and combine local and external cancellation.
  constructor(options: RequestLoopOptions) {
    if (
      !Number.isInteger(options.retryDelayMs) ||
      options.retryDelayMs <= 0 ||
      options.retryDelayMs > 2_147_483_647
    ) {
      throw new Error("Invalid request loop retry delay.");
    }

    // Validate the optional interval within the supported timer range.
    const intervalMs = options.intervalMs ?? 0;

    if (
      !Number.isInteger(intervalMs) ||
      intervalMs < 0 ||
      intervalMs > 2_147_483_647
    ) {
      throw new Error("Invalid request loop interval.");
    }

    this.intervalMs = intervalMs;

    this.signal =
      options.request.signal === undefined
        ? this.stopController.signal
        : AbortSignal.any([this.stopController.signal, options.request.signal]);

    const request: TransportRequest = {
      ...options.request,
      signal: this.signal,
    };

    if (options.request.headers !== undefined) {
      request.headers = { ...options.request.headers };
    }

    this.options = { ...options, request };
  }

  // Repeated calls share the same running loop.
  run(): Promise<void> {
    this.runPromise ??= this.execute();
    return this.runPromise;
  }

  // Keep at most one request active for this loop.
  private async execute(): Promise<void> {
    while (!this.signal.aborted) {
      // Read the clock only when interval scheduling is enabled.
      const startedAt = this.intervalMs > 0 ? performance.now() : 0;
      let response: TransportResponse;

      try {
        response = await this.options.transport.request(this.options.request);
      } catch (error) {
        // Treat cancellation as normal termination.
        if (this.signal.aborted) {
          break;
        }

        this.options.onError(error);

        // Retry failures using their own cancellable delay.
        await this.wait(this.options.retryDelayMs);
        continue;
      }

      if (this.signal.aborted) {
        break;
      }

      // Hand off raw data before scheduling the next request.
      this.options.onResponse(response);

      // Count request and handoff time toward the configured interval.
      if (this.intervalMs > 0 && !this.signal.aborted) {
        const remaining = this.intervalMs - (performance.now() - startedAt);

        if (remaining > 0) {
          await this.wait(Math.ceil(remaining));
        }
      }
    }
  }

  // Treat cancellation during either kind of delay as normal termination.
  private async wait(durationMs: number): Promise<void> {
    try {
      await delay(durationMs, undefined, { signal: this.signal });
    } catch (error) {
      if (!this.signal.aborted) {
        throw error;
      }
    }
  }

  // Cancel the active request or retry delay and wait for loop termination.
  async stop(): Promise<void> {
    this.stopController.abort();
    await this.runPromise;
  }
}
