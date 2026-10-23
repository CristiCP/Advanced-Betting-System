import type { SuperbetHandlers } from "./model/controller.interfaces.js";

/**
 * @file Reports Superbet discovery counts and periodic synchronization statistics.
 */

export const superbetConsoleHandlers: SuperbetHandlers = {
  onEvents(events) {
    console.log("Superbet live events:", {
      football: events.filter((event) => event.sportId === 5).length,
      basketball: events.filter((event) => event.sportId === 4).length,
      tennis: events.filter((event) => event.sportId === 2).length,
    });
  },
  onStatus(status) {
    if (status.kind === "stats") console.log("Superbet:", status.stats);
  },
  onError(error, eventId) {
    console.error("Superbet:", { eventId, error });
  },
};
