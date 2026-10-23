import type { BetanoHandlers } from "./model/controller.interfaces.js";

/**
 * @file Reports Betano discovery counts and periodic synchronization statistics.
 */

export const betanoConsoleHandlers: BetanoHandlers = {
  onEvents(events) {
    console.log("Betano live events:", {
      football: events.filter((event) => event.sportId === "FOOT").length,
      basketball: events.filter((event) => event.sportId === "BASK").length,
      tennis: events.filter((event) => event.sportId === "TENN").length,
    });
  },
  onStatus(status) {
    if (status.kind === "stats") console.log("Betano:", status.stats);
  },
  onError(error, eventId) {
    console.error("Betano:", { eventId, error });
  },
};
