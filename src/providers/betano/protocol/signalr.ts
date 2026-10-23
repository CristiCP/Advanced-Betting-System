import type {
  PendingSignalRInvocation,
  SignalRHandlers,
  SignalRMessage,
} from "../model/signalr.interfaces.js";
import { isRecord } from "../processing/state.js";

/**
 * @file Handles SignalR framing, invocation acknowledgements, and protocol heartbeats.
 */

export class SignalRSession {
  private buffer = "";
  private active = false;
  private stopped = false;
  private nextId = 1;
  private readonly pending = new Map<string, PendingSignalRInvocation>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private handshake: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly timeoutMs: number,
    private readonly heartbeatMs: number,
    private readonly maxMessageBytes: number,
    private readonly handlers: SignalRHandlers,
  ) {}

  get ready(): boolean {
    return this.active && !this.stopped;
  }

  start(): void {
    this.handshake = setTimeout(
      () => this.fail(new Error("SignalR handshake timed out.")),
      this.timeoutMs,
    );
    this.send({ protocol: "json", version: 1 });
  }

  // Records can span WebSocket messages or share one message.
  receive(chunk: ArrayBuffer): void {
    if (this.stopped) return;
    this.buffer += Buffer.from(chunk).toString("utf8");
    if (Buffer.byteLength(this.buffer) > this.maxMessageBytes)
      throw new Error("SignalR message limit exceeded.");
    for (;;) {
      const index = this.buffer.indexOf("\x1e");
      if (index < 0) break;
      const record = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (!record) continue;
      const value: unknown = JSON.parse(record);
      if (!isRecord(value)) throw new Error("Invalid SignalR message.");
      const message = value as SignalRMessage;
      if (!this.active) {
        if (message.error || message.type !== undefined)
          throw new Error(
            message.error ?? "Invalid SignalR handshake response.",
          );
        if (this.handshake !== null) clearTimeout(this.handshake);
        this.active = true;
        this.heartbeat = setInterval(
          () => this.send({ type: 6 }),
          this.heartbeatMs,
        );
        this.handlers.onReady();
      } else if (
        message.type === 1 &&
        typeof message.target === "string" &&
        Array.isArray(message.arguments)
      ) {
        this.handlers.onInvocation(message.target, message.arguments);
      } else if (
        message.type === 3 &&
        typeof message.invocationId === "string"
      ) {
        const pending = this.pending.get(message.invocationId);
        this.pending.delete(message.invocationId);
        if (pending) {
          clearTimeout(pending.timer);
          message.error
            ? pending.reject(new Error(message.error))
            : pending.resolve();
        }
      } else if (message.type === 7) {
        throw new Error(
          message.error ?? "SignalR server requested reconnection.",
        );
      }
    }
  }

  invoke(target: string, argument: unknown): Promise<void> {
    if (!this.ready)
      return Promise.reject(new Error("SignalR handshake is not complete."));
    const invocationId = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(invocationId);
        reject(new Error(`SignalR invocation timed out: ${target}`));
      }, this.timeoutMs);
      this.pending.set(invocationId, { resolve, reject, timer });
      this.send({ type: 1, invocationId, target, arguments: [argument] });
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.handshake !== null) clearTimeout(this.handshake);
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("SignalR session stopped."));
    }
    this.pending.clear();
    this.buffer = "";
  }

  private send(message: unknown): void {
    void this.handlers
      .send(JSON.stringify(message) + "\x1e")
      .catch((error: unknown) =>
        this.fail(error instanceof Error ? error : new Error(String(error))),
      );
  }

  private fail(error: Error): void {
    if (!this.stopped) {
      this.stop();
      this.handlers.onError(error);
    }
  }
}
