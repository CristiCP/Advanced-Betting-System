import { MessageChannel, Worker } from "node:worker_threads";
import { NetworkWorkerController } from "../../network/controller.js";
import { betanoConfig } from "./config.js";
import type { BetanoOptions } from "./model/config.interfaces.js";
import type {
  BetanoHandlers,
  BetanoProvider,
  PendingBetanoQuery,
} from "./model/controller.interfaces.js";
import type { BetanoStats } from "./model/feed.interfaces.js";
import type { BetanoEvent, BetanoSnapshot } from "./model/state.interfaces.js";
import type {
  BetanoQueryCommand,
  BetanoWorkerCommand,
  BetanoWorkerData,
  BetanoWorkerMessage,
} from "./model/worker.interfaces.js";

/**
 * @file Owns Betano network and processing workers behind one provider API.
 */

export class BetanoController implements BetanoProvider {
  private readonly options: BetanoOptions;
  private network: NetworkWorkerController | null = null;
  private worker: Worker | null = null;
  private exit: Promise<number> | null = null;
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private ready = false;
  private nextCommandId = 1;
  private readonly pending = new Map<number, PendingBetanoQuery>();

  constructor(
    options: Partial<BetanoOptions> = {},
    private readonly handlers: BetanoHandlers = {},
  ) {
    this.options = { ...betanoConfig, ...options };
    if (
      new URL(this.options.origin).protocol !== "https:" ||
      new URL(this.options.origin).origin !== this.options.origin
    )
      throw new Error("Betano origin must be an HTTPS origin.");
    for (const [key, value] of Object.entries(this.options)) {
      if (
        key !== "origin" &&
        (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
      )
        throw new Error(`Invalid Betano option: ${key}`);
    }
    if (this.options.serverTimeoutMs <= this.options.heartbeatMs)
      throw new Error("Server timeout must exceed the heartbeat interval.");
  }

  start(): Promise<void> {
    if (this.stopping !== null)
      return Promise.reject(new Error("Betano provider has stopped."));
    this.starting ??= this.initialize();
    return this.starting;
  }

  private async initialize(): Promise<void> {
    const channel = new MessageChannel();
    const worker = new Worker(new URL("./workers/worker.js", import.meta.url), {
      workerData: {
        options: this.options,
        networkPort: channel.port1,
        publishSnapshots: this.handlers.onSnapshot !== undefined,
        publishUpdates: this.handlers.onUpdate !== undefined,
      } satisfies BetanoWorkerData,
      transferList: [channel.port1],
    });
    this.worker = worker;
    this.exit = new Promise((resolve) =>
      worker.once("exit", (code) => {
        this.ready = false;
        this.worker = null;
        this.rejectPending(
          new Error(`Betano processing worker exited (${code}).`),
        );
        resolve(code);
        if (this.stopping === null) {
          this.handlers.onError?.(
            `Betano processing worker exited unexpectedly (${code}).`,
          );
          void this.stop().catch((error: unknown) =>
            console.error("Betano cleanup failed:", error),
          );
        }
      }),
    );
    const ready = new Promise<void>((resolve, reject) => {
      worker.on("message", (message: BetanoWorkerMessage) => {
        try {
          if (message.type === "ready") {
            this.ready = true;
            resolve();
          } else if (message.type === "fatal") {
            reject(new Error(message.error));
            this.handlers.onError?.(message.error);
          } else this.handle(message);
        } catch (error) {
          reject(error);
          console.error("Betano event handler failed:", error);
          void this.stop().catch((failure: unknown) =>
            console.error("Betano cleanup failed:", failure),
          );
        }
      });
      worker.on("error", reject);
      worker.once("exit", (code) =>
        reject(
          new Error(`Betano worker exited before startup completed (${code}).`),
        ),
      );
    });
    // Observe early failures while waiting for network initialization.
    void ready.catch(() => {});
    this.network = new NetworkWorkerController(
      {
        transports: [
          {
            origin: this.options.origin,
            engine: "browser",
            connectTimeoutMs: this.options.requestTimeoutMs,
            requestTimeoutMs: this.options.requestTimeoutMs,
            maxHttp1Connections: 4,
          },
        ],
      },
      {
        onFailure: (error) => {
          this.handlers.onError?.(error.message);
          void this.stop().catch((failure: unknown) =>
            console.error("Betano cleanup failed:", failure),
          );
        },
      },
      channel.port2,
    );
    try {
      await this.network.start();
      if (this.stopping !== null)
        throw new Error("Betano startup was cancelled.");
      worker.postMessage("start" satisfies BetanoWorkerCommand);
      await ready;
    } catch (error) {
      try {
        await this.stop();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Betano startup and cleanup failed.",
        );
      }
      throw error;
    }
  }

  private handle(message: BetanoWorkerMessage): void {
    switch (message.type) {
      case "events":
        this.handlers.onEvents?.(message.events);
        break;
      case "snapshot":
        this.handlers.onSnapshot?.(message.snapshot);
        break;
      case "update":
        this.handlers.onUpdate?.(message.diff);
        break;
      case "removed":
        this.handlers.onRemove?.(message.eventId);
        break;
      case "status":
        this.handlers.onStatus?.(message.status);
        break;
      case "error":
        this.handlers.onError?.(message.error, message.eventId);
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

  getEvents(): Promise<BetanoEvent[]> {
    return this.query("events") as Promise<BetanoEvent[]>;
  }
  getSnapshot(eventId: number): Promise<BetanoSnapshot | null> {
    if (!Number.isSafeInteger(eventId) || eventId <= 0)
      return Promise.reject(new Error("Invalid Betano event ID."));
    return this.query("snapshot", eventId) as Promise<BetanoSnapshot | null>;
  }
  getStats(): Promise<BetanoStats> {
    return this.query("stats") as Promise<BetanoStats>;
  }
  async reconnect(): Promise<void> {
    await this.query("reconnect");
  }

  private query(
    operation: BetanoQueryCommand["operation"],
    eventId?: number,
  ): Promise<unknown> {
    if (!this.ready || this.worker === null || this.stopping !== null)
      return Promise.reject(new Error("Betano provider is not ready."));
    const commandId = this.nextCommandId++;
    if (!Number.isSafeInteger(commandId))
      return Promise.reject(new Error("Betano command ID limit reached."));
    return new Promise((resolve, reject) => {
      this.pending.set(commandId, { resolve, reject });
      try {
        this.worker!.postMessage({
          type: "query",
          commandId,
          operation,
          ...(eventId === undefined ? {} : { eventId }),
        } satisfies BetanoQueryCommand);
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

  // Let processing release its subscriptions before shutting down native networking.
  private async shutdown(): Promise<void> {
    this.ready = false;
    this.rejectPending(new Error("Betano provider is stopping."));
    const errors: unknown[] = [];
    const worker = this.worker;
    if (worker !== null && this.exit !== null) {
      worker.postMessage("stop" satisfies BetanoWorkerCommand);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const code = await Promise.race([
          this.exit,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Betano processing shutdown timed out.")),
              15_000,
            );
          }),
        ]);
        if (code !== 0)
          errors.push(new Error(`Betano worker exited (${code}).`));
      } catch (error) {
        errors.push(error);
        await worker.terminate();
      } finally {
        clearTimeout(timer);
      }
    }
    try {
      await this.network?.stop();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, "Betano shutdown failed.");
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
