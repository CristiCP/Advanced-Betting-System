import { MessageChannel, Worker } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";
import { aggregationConfig } from "./config.js";
import type { AggregationOptions } from "./model/config.interfaces.js";
import type {
  AggregationApi,
  AggregationHandlers,
  PendingAggregationQuery,
} from "./model/controller.interfaces.js";
import type { AggregationProvider } from "./model/wire.interfaces.js";
import type {
  AggregationQueryCommand,
  AggregationStats,
  AggregationWorkerCommand,
  AggregationWorkerData,
  AggregationWorkerMessage,
  AggregationWorkerPort,
} from "./model/worker.interfaces.js";
import { isOutboxOptions, isProvider } from "./protocol/validation.js";
import { isCondition, validateMapping } from "./mapping.js";
import { footballMarketMapping } from "./mapping.config.js";
import { superbetFootballMarkets } from "../providers/superbet/football-markets.config.js";
import { betanoFootballMarkets } from "../providers/betano/football-markets.config.js";

/**
 * @file Owns the aggregation worker and the direct ports handed to provider processing workers.
 */

export class AggregationController implements AggregationApi {
  private readonly options: AggregationOptions;
  private readonly ports: AggregationWorkerPort[] = [];
  private worker: Worker | null = null;
  private exit: Promise<number> | null = null;
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private ready = false;
  private nextCommandId = 1;
  private readonly pending = new Map<number, PendingAggregationQuery>();

  constructor(
    options: Partial<AggregationOptions> = {},
    private readonly handlers: AggregationHandlers = {},
  ) {
    this.options = { ...aggregationConfig, ...options };
    const { enabledConditions, fallbackMode, recordPath, learningPath, ...numbers } =
      this.options;
    for (const [key, value] of Object.entries(numbers)) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
        throw new Error(`Invalid aggregation option: ${key}`);
    }
    if (!Array.isArray(enabledConditions) || !enabledConditions.every(isCondition))
      throw new Error("Invalid aggregation option: enabledConditions");
    if (fallbackMode !== "off" && fallbackMode !== "observe")
      throw new Error("Invalid aggregation option: fallbackMode");
    for (const [key, value] of Object.entries({ recordPath, learningPath }))
      if (value !== null && (typeof value !== "string" || value.trim() === ""))
        throw new Error(`Invalid aggregation option: ${key}`);
    if (this.options.minMarginBps >= this.options.suspiciousMarginBps)
      throw new Error("minMarginBps must be below suspiciousMarginBps.");
    if (!isOutboxOptions(this.options))
      throw new Error(
        "Aggregation limits are inconsistent: the batch limit must hold twice the full state.",
      );
    // Refuse to start when the mapping contradicts either provider catalog.
    const errors = validateMapping(
      footballMarketMapping,
      new Map(superbetFootballMarkets.map((market) => [market.id, market])),
      new Map(betanoFootballMarkets.map((market) => [market.typeId, market])),
    );
    if (errors.length)
      throw new Error(`Invalid football market mapping:\n${errors.join("\n")}`);
  }

  // Ports are created before start, so each provider can transfer its end to its own worker.
  createPort(provider: AggregationProvider): MessagePort {
    if (!isProvider(provider))
      throw new Error("Unknown aggregation provider.");
    if (this.starting !== null || this.stopping !== null)
      throw new Error("Aggregation ports must be created before start.");
    if (this.ports.some((entry) => entry.provider === provider))
      throw new Error(`Aggregation port already exists for ${provider}.`);
    const channel = new MessageChannel();
    this.ports.push({ provider, port: channel.port1 });
    return channel.port2;
  }

  start(): Promise<void> {
    if (this.stopping !== null)
      return Promise.reject(new Error("Aggregation has stopped."));
    this.starting ??= this.initialize();
    return this.starting;
  }

  private async initialize(): Promise<void> {
    const worker = new Worker(new URL("./workers/worker.js", import.meta.url), {
      workerData: {
        options: this.options,
        ports: this.ports,
      } satisfies AggregationWorkerData,
      transferList: this.ports.map((entry) => entry.port),
    });
    this.worker = worker;
    this.exit = new Promise((resolve) =>
      worker.once("exit", (code) => {
        this.ready = false;
        this.worker = null;
        this.rejectPending(new Error(`Aggregation worker exited (${code}).`));
        resolve(code);
        if (this.stopping === null) {
          this.handlers.onError?.(
            `Aggregation worker exited unexpectedly (${code}).`,
          );
          void this.stop().catch((error: unknown) =>
            console.error("Aggregation cleanup failed:", error),
          );
        }
      }),
    );
    const ready = new Promise<void>((resolve, reject) => {
      worker.on("message", (message: AggregationWorkerMessage) => {
        try {
          if (message.type === "ready") {
            this.ready = true;
            resolve();
          } else if (message.type === "fatal") {
            reject(new Error(message.error));
            this.handlers.onError?.(message.error);
          } else this.handle(message);
        } catch (error) {
          console.error("Aggregation handler failed:", error);
        }
      });
      worker.on("error", reject);
      worker.once("exit", (code) =>
        reject(
          new Error(
            `Aggregation worker exited before startup completed (${code}).`,
          ),
        ),
      );
    });
    try {
      worker.postMessage("start" satisfies AggregationWorkerCommand);
      await ready;
    } catch (error) {
      try {
        await this.stop();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Aggregation startup and cleanup failed.",
        );
      }
      throw error;
    }
  }

  private handle(message: AggregationWorkerMessage): void {
    switch (message.type) {
      case "status":
        this.handlers.onStatus?.(message.status);
        break;
      case "reports":
        for (const report of message.reports) {
          if (report.kind === "pair") this.handlers.onPair?.(report);
          else if (report.kind === "observed") this.handlers.onObserved?.(report);
          else {
            const { type: _type, ...opportunity } = report;
            this.handlers.onOpportunity?.(opportunity);
          }
        }
        break;
      case "error":
        this.handlers.onError?.(message.error, message.provider);
        break;
      case "result": {
        const pending = this.pending.get(message.commandId);
        this.pending.delete(message.commandId);
        message.error
          ? pending?.reject(new Error(message.error))
          : pending?.resolve(message.value);
        break;
      }
    }
  }

  getStats(): Promise<AggregationStats> {
    if (!this.ready || this.worker === null || this.stopping !== null)
      return Promise.reject(new Error("Aggregation is not ready."));
    const commandId = this.nextCommandId++;
    if (!Number.isSafeInteger(commandId))
      return Promise.reject(new Error("Aggregation command ID limit reached."));
    return new Promise((resolve, reject) => {
      this.pending.set(commandId, {
        resolve: (value) => resolve(value as AggregationStats),
        reject,
      });
      try {
        this.worker!.postMessage({
          type: "query",
          commandId,
          operation: "stats",
        } satisfies AggregationQueryCommand);
      } catch (error) {
        this.pending.delete(commandId);
        reject(error);
      }
    });
  }

  stop(): Promise<void> {
    this.stopping ??= this.shutdown();
    return this.stopping;
  }

  // Ports never handed to a worker are closed here so provider outboxes observe the shutdown.
  private async shutdown(): Promise<void> {
    this.ready = false;
    this.rejectPending(new Error("Aggregation is stopping."));
    const worker = this.worker;
    if (worker === null || this.exit === null) {
      for (const entry of this.ports) entry.port.close();
      return;
    }
    worker.postMessage("stop" satisfies AggregationWorkerCommand);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await Promise.race([
        this.exit,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Aggregation shutdown timed out.")),
            15_000,
          );
        }),
      ]);
      if (code !== 0) throw new Error(`Aggregation worker exited (${code}).`);
    } catch (error) {
      await worker.terminate();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
