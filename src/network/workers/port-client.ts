import type { MessagePort } from "node:worker_threads";
import type {
  NetworkWorkerCommand,
  NetworkWorkerMessage,
} from "../model/worker.interfaces.js";
import type {
  NetworkPortCommand,
  PendingPortCommand,
} from "../model/port-client.interfaces.js";

/**
 * @file Exchanges commands and transferable payloads directly with a network worker.
 */

export class NetworkPortClient {
  private readonly pending = new Map<number, PendingPortCommand>();
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly port: MessagePort,
    onMessage: (message: NetworkWorkerMessage) => void,
  ) {
    port.on("message", (message: NetworkWorkerMessage) => {
      if (
        message.type === "command-success" ||
        message.type === "command-error" ||
        message.type === "request-response"
      ) {
        const pending = this.pending.get(message.commandId);
        this.pending.delete(message.commandId);
        if (message.type === "command-error")
          pending?.reject(new Error(message.error));
        else pending?.resolve(message);
      } else onMessage(message);
    });
    port.once("close", () => this.close());
  }

  // Assign IDs locally so the processing worker can issue concurrent requests.
  command(command: NetworkPortCommand): Promise<NetworkWorkerMessage> {
    if (this.closed)
      return Promise.reject(new Error("Network consumer port is closed."));
    const commandId = this.nextId++;
    if (!Number.isSafeInteger(commandId))
      return Promise.reject(new Error("Network command ID limit reached."));
    return new Promise((resolve, reject) => {
      this.pending.set(commandId, { resolve, reject });
      try {
        this.port.postMessage({ ...command, commandId });
      } catch (error) {
        this.pending.delete(commandId);
        reject(error);
      }
    });
  }

  post(command: NetworkWorkerCommand): void {
    if (!this.closed) this.port.postMessage(command);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values())
      pending.reject(new Error("Network consumer port closed."));
    this.pending.clear();
    this.port.close();
  }
}
