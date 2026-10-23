import type { BetanoRecord } from "./state.interfaces.js";

export interface SignalRHandlers {
  send(data: string): Promise<void>;
  onReady(): void;
  onInvocation(target: string, args: unknown[]): void;
  onError(error: Error): void;
}

export interface PendingSignalRInvocation {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SignalRMessage extends BetanoRecord {
  type?: number;
  error?: string;
  target?: string;
  arguments?: unknown[];
  invocationId?: string;
}
