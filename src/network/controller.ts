import { Worker } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";
import type {
  NetworkControllerHandlers,
  NetworkStreamingController,
  NetworkLoopOptions,
  NetworkSubscriptionOptions,
  PendingNetworkCommand,
} from "./model/controller.interfaces.js";
import type {
  NetworkConfirmedCommand,
  NetworkStreamMessage,
  NetworkWorkerCommand,
  NetworkWorkerData,
  NetworkWorkerMessage,
} from "./model/worker.interfaces.js";

/**
 * @file Controls network loops and SSE delivery with ordered byte acknowledgements.
 */

export class NetworkWorkerController implements NetworkStreamingController {
  private worker: Worker | null = null;
  private exitPromise: Promise<number> | null = null;
  private readonly pendingCommands = new Map<number, PendingNetworkCommand>();
  private readonly streamDeliveries = new Map<string, Promise<void>>();
  private nextCommandId = 1;
  private ready = false;
  private stopRequested = false;
  private failureReported = false;
  private readonly data: NetworkWorkerData;
  private readonly handlers: NetworkControllerHandlers | undefined;

  // Snapshot startup settings and store the application's event handlers.
  constructor(
    data: NetworkWorkerData,
    handlers?: NetworkControllerHandlers,
    private readonly consumerPort?: MessagePort,
  ) {
    this.data = structuredClone(data);
    this.handlers = handlers;
  }

  // Start one worker and wait for its readiness confirmation.
  async start(): Promise<void> {
    if (this.exitPromise !== null) {
      throw new Error("This controller has already started a worker.");
    }

    const worker = new Worker(new URL("./workers/worker.js", import.meta.url), {
      workerData: {
        ...this.data,
        ...(this.consumerPort === undefined
          ? {}
          : { consumerPort: this.consumerPort }),
      },
      transferList: this.consumerPort === undefined ? [] : [this.consumerPort],
    });

    this.worker = worker;

    // Settle outstanding commands whenever the worker exits.
    this.exitPromise = new Promise<number>((resolve) => {
      worker.once("exit", (code: number) => {
        this.worker = null;
        this.ready = false;
        this.rejectPending(new Error(`Network worker exited. Code: ${code}`));
        this.streamDeliveries.clear();
        resolve(code);

        if (!this.stopRequested || code !== 0) {
          console.error(`Network worker exited unexpectedly. Code: ${code}`);
          process.exitCode = 1;
          this.reportFailure(new Error(`Network worker exited. Code: ${code}`));
        }
      });
    });

    // Keep one message listener for readiness, confirmations, and loop events.
    await new Promise<void>((resolve, reject) => {
      let startupConfirmed = false;

      worker.on("message", (message: NetworkWorkerMessage) => {
        if (message.type === "network-ready") {
          if (!startupConfirmed && !this.stopRequested) {
            startupConfirmed = true;
            this.ready = true;
            resolve();
          }

          return;
        }

        // Stop cleanly if an application callback throws.
        try {
          this.handleMessage(message);
        } catch (error) {
          this.handleEventFailure(error);
        }
      });

      // Reject startup and pending commands on uncaught worker failures.
      worker.on("error", (error: Error) => {
        this.ready = false;
        this.rejectPending(error);
        console.error("Network worker error:", error);
        this.reportFailure(error);
        process.exitCode = 1;
        reject(error);
      });

      worker.once("exit", () => {
        if (!startupConfirmed) {
          reject(new Error("Network worker exited before becoming ready."));
        }
      });
    });

    this.handlers?.onReady?.(worker.threadId);
  }

  // Resolve only after the worker accepts the new loop.
  async startLoop(options: NetworkLoopOptions): Promise<void> {
    if (
      this.handlers?.onResponse === undefined ||
      this.handlers.onError === undefined
    ) {
      throw new Error("Response handlers are required before starting loops.");
    }

    await this.sendCommand({
      ...options,
      type: "start-loop",
      commandId: this.nextCommandId++,
    });
  }

  // Resolve only after the worker finishes stopping the selected loop.
  async stopLoop(id: string): Promise<void> {
    await this.sendCommand({
      type: "stop-loop",
      commandId: this.nextCommandId++,
      id,
    });
  }

  // Confirm registration separately from the asynchronous SSE opening event.
  async startSubscription(options: NetworkSubscriptionOptions): Promise<void> {
    if (this.handlers?.streams === undefined) {
      throw new Error(
        "Stream handlers are required before starting subscriptions.",
      );
    }
    await this.sendCommand({
      ...options,
      type: "start-subscription",
      commandId: this.nextCommandId++,
    });
  }

  // Wait until the worker has cancelled the selected stream and reconnect delay.
  async stopSubscription(id: string): Promise<void> {
    await this.sendCommand({
      type: "stop-subscription",
      commandId: this.nextCommandId++,
      id,
    });
  }

  // Register the confirmation promise before posting its command.
  private sendCommand(command: NetworkConfirmedCommand): Promise<void> {
    const worker = this.worker;

    if (worker === null || !this.ready || this.stopRequested) {
      return Promise.reject(new Error("Network worker is not ready."));
    }

    if (!Number.isSafeInteger(command.commandId)) {
      return Promise.reject(new Error("Network command ID limit reached."));
    }

    return new Promise<void>((resolve, reject) => {
      this.pendingCommands.set(command.commandId, { resolve, reject });

      try {
        worker.postMessage(command);
      } catch (error) {
        this.pendingCommands.delete(command.commandId);
        reject(error);
      }
    });
  }

  // Route confirmations to their promises and raw events to the application.
  private handleMessage(message: NetworkWorkerMessage): void {
    switch (message.type) {
      case "command-success":
      case "command-error": {
        const pending = this.pendingCommands.get(message.commandId);

        if (pending === undefined) {
          return;
        }

        this.pendingCommands.delete(message.commandId);

        if (message.type === "command-success") {
          pending.resolve();
        } else {
          pending.reject(new Error(message.error));
        }

        return;
      }

      case "loop-response":
        this.handlers?.onResponse?.(message);
        return;

      case "loop-error":
        this.handlers?.onError?.(message);
        return;

      case "stream-open":
      case "stream-chunk":
      case "stream-end":
      case "stream-error":
      case "stream-stopped":
        this.deliverStreamMessage(message);
        return;
    }
  }

  // Preserve delivery order for an ID even when a new generation reuses it.
  private deliverStreamMessage(message: NetworkStreamMessage): void {
    const previous = this.streamDeliveries.get(message.id) ?? Promise.resolve();
    const delivery = previous.then(async () => {
      if (this.stopRequested) {
        return;
      }
      const handlers = this.handlers?.streams;
      if (handlers === undefined) {
        throw new Error("No consumer is configured for SSE delivery.");
      }

      switch (message.type) {
        case "stream-open":
          await handlers.onOpen(message);
          break;
        case "stream-chunk":
          await handlers.onChunk(message);
          // Acknowledgements carry no payload and receive no command response.
          if (this.ready && !this.stopRequested) {
            this.worker?.postMessage({
              type: "ack-stream",
              id: message.id,
              generation: message.generation,
              sequence: message.sequence,
            } satisfies NetworkWorkerCommand);
          }
          break;
        case "stream-end":
          await handlers.onEnd(message);
          break;
        case "stream-error":
          await handlers.onError(message);
          break;
        case "stream-stopped":
          await handlers.onStopped?.(message);
          break;
      }
    });
    this.streamDeliveries.set(message.id, delivery);
    const release = (): void => {
      if (this.streamDeliveries.get(message.id) === delivery) {
        this.streamDeliveries.delete(message.id);
      }
    };
    void delivery.then(release, (error: unknown) => {
      release();
      this.handleEventFailure(error);
    });
  }

  // Apply the same shutdown policy to synchronous and async consumer failures.
  private handleEventFailure(error: unknown): void {
    if (this.stopRequested) {
      return;
    }
    console.error("Network event handler failed:", error);
    process.exitCode = 1;
    void this.stop().catch((shutdownError: unknown) => {
      console.error("Network worker shutdown failed:", shutdownError);
    });
  }

  // Notify an owning provider once when its network worker fails.
  private reportFailure(error: Error): void {
    if (this.failureReported) return;
    this.failureReported = true;
    this.handlers?.onFailure?.(error);
  }

  // Release all command promises when further confirmations cannot be awaited.
  private rejectPending(error: Error): void {
    for (const pending of this.pendingCommands.values()) {
      pending.reject(error);
    }

    this.pendingCommands.clear();
  }

  // Prevent new commands, request shutdown once, and await worker termination.
  async stop(): Promise<void> {
    const exitPromise = this.exitPromise;

    if (exitPromise === null) {
      return;
    }

    if (!this.stopRequested) {
      this.stopRequested = true;
      this.ready = false;
      this.rejectPending(new Error("Network worker is stopping."));
      this.worker?.postMessage("stop" satisfies NetworkWorkerCommand);
    }

    const code = await exitPromise;

    if (code !== 0) {
      throw new Error(`Network worker shutdown failed. Code: ${code}`);
    }
  }
}
