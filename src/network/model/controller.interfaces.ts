import type {
  NetworkLoopErrorMessage,
  NetworkLoopResponseMessage,
  NetworkStartLoopCommand,
  NetworkStartSubscriptionCommand,
  NetworkStreamChunkMessage,
  NetworkStreamEndMessage,
  NetworkStreamErrorMessage,
  NetworkStreamOpenMessage,
  NetworkStreamStoppedMessage,
} from "./worker.interfaces.js";

// Define how the application starts and stops networking.
export interface NetworkController {
  // Resolve when the worker confirms that it is ready.
  start(): Promise<void>;

  // Resolve when the worker has finished shutting down.
  stop(): Promise<void>;
}

// Define loop settings without internal command metadata.
export interface NetworkLoopOptions extends Omit<
  NetworkStartLoopCommand,
  "type" | "commandId"
> {}

// Define how the application receives raw responses and request failures.
export interface NetworkControllerHandlers {
  onReady?(threadId: number): void;
  onFailure?(error: Error): void;
  onResponse?(message: NetworkLoopResponseMessage): void;
  onError?(message: NetworkLoopErrorMessage): void;
  streams?: NetworkSubscriptionHandlers;
}

// Keep consumer callbacks ordered per subscription, including async handoffs.
export interface NetworkSubscriptionHandlers {
  onOpen(message: NetworkStreamOpenMessage): void | Promise<void>;
  // Release byte credit only after this callback completes.
  onChunk(message: NetworkStreamChunkMessage): void | Promise<void>;
  onEnd(message: NetworkStreamEndMessage): void | Promise<void>;
  onError(message: NetworkStreamErrorMessage): void | Promise<void>;
  onStopped?(message: NetworkStreamStoppedMessage): void | Promise<void>;
}

// Define SSE settings without internal command metadata.
export interface NetworkSubscriptionOptions extends Omit<
  NetworkStartSubscriptionCommand,
  "type" | "commandId"
> {}

// Extend worker lifecycle control with individual loop management.
export interface NetworkLoopController extends NetworkController {
  // Resolve when the worker confirms that the loop has started.
  startLoop(options: NetworkLoopOptions): Promise<void>;

  // Resolve when the worker confirms that the loop has stopped.
  stopLoop(id: string): Promise<void>;
}

// Extend loop control with individually identified SSE subscriptions.
export interface NetworkStreamingController extends NetworkLoopController {
  startSubscription(options: NetworkSubscriptionOptions): Promise<void>;
  stopSubscription(id: string): Promise<void>;
}

// Store the callbacks for a command awaiting worker confirmation.
export interface PendingNetworkCommand {
  resolve(): void;
  reject(error: Error): void;
}
