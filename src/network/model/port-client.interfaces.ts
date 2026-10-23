import type {
  NetworkConfirmedCommand,
  NetworkWorkerMessage,
} from "./worker.interfaces.js";

type WithoutCommandId<T> = T extends unknown ? Omit<T, "commandId"> : never;
export type NetworkPortCommand = WithoutCommandId<NetworkConfirmedCommand>;

export interface PendingPortCommand {
  resolve(message: NetworkWorkerMessage): void;
  reject(error: Error): void;
}
