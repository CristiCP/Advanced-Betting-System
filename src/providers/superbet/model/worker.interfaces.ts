import type { MessagePort } from "node:worker_threads";
import type {
  SuperbetTennisChange,
  SuperbetTennisSnapshot,
} from "./tennis-projection.interfaces.js";
import type {
  SuperbetFootballChange,
  SuperbetFootballSnapshot,
} from "./football-projection.interfaces.js";
import type {
  SuperbetFeedConfiguration,
  SuperbetStatus,
} from "./feed.interfaces.js";
import type {
  SuperbetUpdate,
  SuperbetEvent,
  SuperbetSnapshot,
} from "./state.interfaces.js";

import type {
  UiQuoteMessage,
  UiWatchCommand,
} from "../../../ui/model/ui.interfaces.js";

export interface SuperbetWorkerData extends SuperbetFeedConfiguration {
  observeUi?: boolean;
  networkPort: MessagePort;
  aggregationPort?: MessagePort;
  tennisAggregationPort?: MessagePort;
}

export interface SuperbetQueryCommand {
  type: "query";
  commandId: number;
  operation:
    | "events"
    | "snapshot"
    | "football-snapshot"
    | "tennis-snapshot"
    | "stats"
    | "reconnect";
  eventId?: number;
}

export type SuperbetWorkerCommand =
  | SuperbetQueryCommand
  | UiWatchCommand
  | { type: "ui-ack" }
  | "start"
  | "stop";

export type SuperbetWorkerMessage =
  | UiQuoteMessage
  | { type: "ready" }
  | { type: "events"; events: SuperbetEvent[] }
  | { type: "snapshot"; snapshot: SuperbetSnapshot }
  | { type: "update"; update: SuperbetUpdate }
  | { type: "football-snapshot"; snapshot: SuperbetFootballSnapshot }
  | { type: "football-update"; change: SuperbetFootballChange }
  | { type: "tennis-snapshot"; snapshot: SuperbetTennisSnapshot }
  | { type: "tennis-update"; change: SuperbetTennisChange }
  | { type: "removed"; eventId: number }
  | { type: "status"; status: SuperbetStatus }
  | { type: "error"; error: string; eventId?: number }
  | { type: "fatal"; error: string }
  | { type: "result"; commandId: number; value?: unknown; error?: string };
