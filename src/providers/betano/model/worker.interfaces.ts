import type { MessagePort } from "node:worker_threads";
import type {
  BetanoFeedConfiguration,
  BetanoStatus,
} from "./feed.interfaces.js";
import type {
  BetanoDiff,
  BetanoEvent,
  BetanoSnapshot,
} from "./state.interfaces.js";

export interface BetanoWorkerData extends BetanoFeedConfiguration {
  networkPort: MessagePort;
}

export interface BetanoQueryCommand {
  type: "query";
  commandId: number;
  operation: "events" | "snapshot" | "stats" | "reconnect";
  eventId?: number;
}

export type BetanoWorkerCommand = BetanoQueryCommand | "start" | "stop";

export type BetanoWorkerMessage =
  | { type: "ready" }
  | { type: "events"; events: BetanoEvent[] }
  | { type: "snapshot"; snapshot: BetanoSnapshot }
  | { type: "update"; diff: BetanoDiff }
  | { type: "removed"; eventId: number }
  | { type: "status"; status: BetanoStatus }
  | { type: "error"; error: string; eventId?: number }
  | { type: "fatal"; error: string }
  | { type: "result"; commandId: number; value?: unknown; error?: string };
