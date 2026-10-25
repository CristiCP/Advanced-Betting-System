import { MessageChannel, Worker } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";
import { NetworkWorkerController } from "../../network/controller.js";
import { superbetConfig } from "./config.js";
import type { SuperbetOptions } from "./model/config.interfaces.js";
import type {
  SuperbetHandlers,
  SuperbetProvider,
  PendingSuperbetQuery,
} from "./model/controller.interfaces.js";
import type { SuperbetStats } from "./model/feed.interfaces.js";
import type {
  SuperbetEvent,
  SuperbetSnapshot,
} from "./model/state.interfaces.js";
import type { SuperbetFootballSnapshot } from "./model/football-projection.interfaces.js";
import type { SuperbetTennisSnapshot } from "./model/tennis-projection.interfaces.js";
import type {
  SuperbetQueryCommand,
  SuperbetWorkerCommand,
  SuperbetWorkerData,
  SuperbetWorkerMessage,
} from "./model/worker.interfaces.js";

/**
 * @file Owns Superbet network and processing workers behind one provider API.
 */

export class SuperbetController implements SuperbetProvider {
  private readonly options: SuperbetOptions;
  private network: NetworkWorkerController | null = null;
  private worker: Worker | null = null;
  private exit: Promise<number> | null = null;
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private ready = false;
  private nextCommandId = 1;
  private readonly pending = new Map<number, PendingSuperbetQuery>();

  constructor(
    options: Partial<SuperbetOptions> = {},
    private readonly handlers: SuperbetHandlers = {},
    // Optional direct port to the aggregation worker; transferred to processing at start.
    private readonly aggregationPort: MessagePort | null = null,
    private readonly tennisAggregationPort: MessagePort | null = null,
  ) {
    this.options = { ...superbetConfig, ...options };
    if (
      new URL(this.options.origin).protocol !== "https:" ||
      new URL(this.options.origin).origin !== this.options.origin
    )
      throw new Error("Superbet origin must be an HTTPS origin.");
    for (const [key, value] of Object.entries(this.options)) {
      if (
        key !== "origin" &&
        (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
      )
        throw new Error(`Invalid Superbet option: ${key}`);
    }
  }

  start(): Promise<void> {
    if (this.stopping !== null)
      return Promise.reject(new Error("Superbet provider has stopped."));
    this.starting ??= this.initialize();
    return this.starting;
  }

  private async initialize(): Promise<void> {
    const channel = new MessageChannel();
    const worker = new Worker(new URL("./workers/worker.js", import.meta.url), {
      workerData: {
        options: this.options,
        networkPort: channel.port1,
        ...(this.tennisAggregationPort === null
          ? {}
          : { tennisAggregationPort: this.tennisAggregationPort }),
        ...(this.aggregationPort === null
          ? {}
          : { aggregationPort: this.aggregationPort }),
        publishSnapshots: this.handlers.onSnapshot !== undefined,
        publishUpdates: this.handlers.onUpdate !== undefined,
        publishFootballSnapshots:
          this.handlers.onFootballSnapshot !== undefined,
        publishFootballUpdates: this.handlers.onFootballUpdate !== undefined,
        publishTennisSnapshots: this.handlers.onTennisSnapshot !== undefined,
        publishTennisUpdates: this.handlers.onTennisUpdate !== undefined,
      } satisfies SuperbetWorkerData,
      transferList: [
        channel.port1,
        ...(this.aggregationPort ? [this.aggregationPort] : []),
        ...(this.tennisAggregationPort ? [this.tennisAggregationPort] : []),
      ],
    });
    this.worker = worker;
    this.exit = new Promise((resolve) =>
      worker.once("exit", (code) => {
        this.ready = false;
        this.worker = null;
        this.rejectPending(
          new Error(`Superbet processing worker exited (${code}).`),
        );
        resolve(code);
        if (this.stopping === null) {
          this.handlers.onError?.(
            `Superbet processing worker exited unexpectedly (${code}).`,
          );
          void this.stop().catch((error: unknown) =>
            console.error("Superbet cleanup failed:", error),
          );
        }
      }),
    );
    const ready = new Promise<void>((resolve, reject) => {
      worker.on("message", (message: SuperbetWorkerMessage) => {
        try {
          if (message.type === "ready") {
            this.ready = true;
            console.log(
              `[Thread ${worker.threadId}] Superbet processing ready.`,
            );
            resolve();
          } else if (message.type === "fatal") {
            reject(new Error(message.error));
            this.handlers.onError?.(message.error);
          } else this.handle(message);
        } catch (error) {
          reject(error);
          console.error("Superbet event handler failed:", error);
          void this.stop().catch((failure: unknown) =>
            console.error("Superbet cleanup failed:", failure),
          );
        }
      });
      worker.on("error", reject);
      worker.once("exit", (code) =>
        reject(
          new Error(
            `Superbet worker exited before startup completed (${code}).`,
          ),
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
            connectTimeoutMs: this.options.requestTimeoutMs,
            requestTimeoutMs: this.options.requestTimeoutMs,
            maxHttp1Connections: this.options.maxHttp1Connections,
            maxHttp2Connections: this.options.maxHttp2Connections,
            reservedHttp2Streams: 1,
          },
        ],
      },
      {
        onReady: (threadId) =>
          console.log(`[Thread ${threadId}] Superbet network ready.`),
        onFailure: (error) => {
          this.handlers.onError?.(error.message);
          void this.stop().catch((failure: unknown) =>
            console.error("Superbet cleanup failed:", failure),
          );
        },
      },
      channel.port2,
    );
    try {
      await this.network.start();
      if (this.stopping !== null)
        throw new Error("Superbet startup was cancelled.");
      worker.postMessage("start" satisfies SuperbetWorkerCommand);
      await ready;
    } catch (error) {
      try {
        await this.stop();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Superbet startup and cleanup failed.",
        );
      }
      throw error;
    }
  }

  private handle(message: SuperbetWorkerMessage): void {
    switch (message.type) {
      case "events":
        this.handlers.onEvents?.(message.events);
        break;
      case "snapshot":
        this.handlers.onSnapshot?.(message.snapshot);
        break;
      case "update":
        this.handlers.onUpdate?.(message.update);
        break;
      case "football-snapshot":
        this.handlers.onFootballSnapshot?.(message.snapshot);
        break;
      case "football-update":
        this.handlers.onFootballUpdate?.(message.change);
        break;
      case "tennis-snapshot":
        this.handlers.onTennisSnapshot?.(message.snapshot);
        break;
      case "tennis-update":
        this.handlers.onTennisUpdate?.(message.change);
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

  getEvents(): Promise<SuperbetEvent[]> {
    return this.query("events") as Promise<SuperbetEvent[]>;
  }
  getSnapshot(eventId: number): Promise<SuperbetSnapshot | null> {
    if (!Number.isSafeInteger(eventId) || eventId <= 0)
      return Promise.reject(new Error("Invalid Superbet event ID."));
    return this.query("snapshot", eventId) as Promise<SuperbetSnapshot | null>;
  }
  getFootballSnapshot(
    eventId: number,
  ): Promise<SuperbetFootballSnapshot | null> {
    if (!Number.isSafeInteger(eventId) || eventId <= 0)
      return Promise.reject(new Error("Invalid Superbet event ID."));
    return this.query(
      "football-snapshot",
      eventId,
    ) as Promise<SuperbetFootballSnapshot | null>;
  }
  getStats(): Promise<SuperbetStats> {
    return this.query("stats") as Promise<SuperbetStats>;
  }
  getTennisSnapshot(eventId: number): Promise<SuperbetTennisSnapshot | null> {
    if (!Number.isSafeInteger(eventId) || eventId <= 0)
      return Promise.reject(new Error("Invalid Superbet event ID."));
    return this.query(
      "tennis-snapshot",
      eventId,
    ) as Promise<SuperbetTennisSnapshot | null>;
  }
  async reconnect(): Promise<void> {
    await this.query("reconnect");
  }

  private query(
    operation: SuperbetQueryCommand["operation"],
    eventId?: number,
  ): Promise<unknown> {
    if (!this.ready || this.worker === null || this.stopping !== null)
      return Promise.reject(new Error("Superbet provider is not ready."));
    const commandId = this.nextCommandId++;
    if (!Number.isSafeInteger(commandId))
      return Promise.reject(new Error("Superbet command ID limit reached."));
    return new Promise((resolve, reject) => {
      this.pending.set(commandId, { resolve, reject });
      try {
        this.worker!.postMessage({
          type: "query",
          commandId,
          operation,
          ...(eventId === undefined ? {} : { eventId }),
        } satisfies SuperbetQueryCommand);
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

  // Let processing release its subscriptions before shutting down shared networking.
  private async shutdown(): Promise<void> {
    this.ready = false;
    this.rejectPending(new Error("Superbet provider is stopping."));
    const errors: unknown[] = [];
    const worker = this.worker;
    if (worker !== null && this.exit !== null) {
      worker.postMessage("stop" satisfies SuperbetWorkerCommand);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const code = await Promise.race([
          this.exit,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(new Error("Superbet processing shutdown timed out.")),
              15_000,
            );
          }),
        ]);
        if (code !== 0)
          errors.push(new Error(`Superbet worker exited (${code}).`));
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
      throw new AggregateError(errors, "Superbet shutdown failed.");
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
