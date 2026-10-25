import type { BetanoHandlers } from "./model/controller.interfaces.js";

/**
 * @file Reports Betano provider errors.
 */

export const betanoConsoleHandlers: BetanoHandlers = {
  onError(error, eventId) {
    console.error("Betano:", { eventId, error });
  },
};
