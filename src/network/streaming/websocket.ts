import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "wreq-js";
import type { ReconnectingSocketOptions } from "../model/websocket.interfaces.js";

/**
 * @file Reconnects raw sockets with bounded delivery and cancellable deadlines.
 */

export class ReconnectingSocket {
  private readonly abort = new AbortController();
  private socket: WebSocket | null = null;
  private running: Promise<void> | null = null;
  private attempt = 0;
  private blocked = false;
  private releaseCredit: (() => void) | null = null;

  constructor(private readonly options: ReconnectingSocketOptions) {
    for (const value of [
      options.connectTimeoutMs,
      options.idleTimeoutMs,
      options.retryDelayMs,
      options.maxMessageBytes ?? 8 * 1024 * 1024,
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
        throw new Error("Invalid WebSocket limit.");
    }
  }

  run(): Promise<void> {
    this.running ??= this.execute();
    return this.running;
  }

  // Wait for released byte credit before reconnecting an overloaded consumer.
  resume(): void {
    this.blocked = false;
    this.releaseCredit?.();
    this.releaseCredit = null;
  }

  send(attempt: number, data: string): void {
    if (attempt !== this.attempt || this.socket?.readyState !== WebSocket.OPEN)
      throw new Error("WebSocket attempt is no longer open.");
    this.socket.send(data);
  }

  async stop(): Promise<void> {
    this.abort.abort();
    this.resume();
    this.socket?.close();
    await this.running;
  }

  private async execute(): Promise<void> {
    try {
      while (!this.abort.signal.aborted) {
        if (this.blocked)
          await new Promise<void>((resolve) => {
            this.releaseCredit = resolve;
          });
        if (this.abort.signal.aborted) break;
        const attempt = ++this.attempt;
        try {
          await this.open(attempt);
        } catch (error) {
          if (!this.abort.signal.aborted) this.options.onError(attempt, error);
        }
        if (!this.abort.signal.aborted) {
          try {
            await delay(this.options.retryDelayMs, undefined, {
              signal: this.abort.signal,
            });
          } catch (error) {
            if (!this.abort.signal.aborted) throw error;
          }
        }
      }
    } finally {
      this.options.onStopped();
    }
  }

  private async open(attempt: number): Promise<void> {
    const socket = this.options.transport.openSocket(
      this.options.path,
      this.options.headers ?? {},
      this.options.maxMessageBytes ?? 8 * 1024 * 1024,
    );
    this.socket = socket;
    try {
      await new Promise<void>((resolve, reject) => {
        let opened = false;
        let settled = false;
        let timer: ReturnType<typeof setTimeout>;
        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.abort.signal.removeEventListener("abort", cancel);
          socket.onopen =
            socket.onmessage =
            socket.onerror =
            socket.onclose =
              null;
          socket.close();
          if (opened) this.options.onEnd(attempt, this.abort.signal.aborted);
          error === undefined ? resolve() : reject(error);
        };
        const cancel = (): void => finish();
        const deadline = (ms: number): void => {
          clearTimeout(timer);
          timer = setTimeout(
            () =>
              finish(
                new Error(
                  opened
                    ? "WebSocket became idle."
                    : "WebSocket opening timed out.",
                ),
              ),
            ms,
          );
        };
        socket.onopen = () => {
          if (settled) return;
          opened = true;
          deadline(this.options.idleTimeoutMs);
          this.options.onOpen(attempt);
        };
        socket.onmessage = (event) => {
          if (settled) return;
          deadline(this.options.idleTimeoutMs);
          const bytes =
            typeof event.data === "string"
              ? Buffer.from(event.data)
              : Buffer.from(event.data as ArrayBuffer);
          const chunk = new Uint8Array(bytes).buffer;
          if (!this.options.onChunk(attempt, chunk)) {
            this.blocked = true;
            finish(
              new Error(
                "WebSocket consumer byte limit reached; resynchronization required.",
              ),
            );
          }
        };
        socket.onerror = (event) =>
          finish(new Error(event.message || "WebSocket connection failed."));
        socket.onclose = (event) =>
          finish(
            this.abort.signal.aborted
              ? undefined
              : new Error(`WebSocket closed (${event.code}).`),
          );
        this.abort.signal.addEventListener("abort", cancel, { once: true });
        deadline(this.options.connectTimeoutMs);
        if (this.abort.signal.aborted) finish();
      });
    } finally {
      if (this.socket === socket) this.socket = null;
    }
  }
}
