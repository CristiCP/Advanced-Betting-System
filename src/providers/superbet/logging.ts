import type { SuperbetHandlers } from "./model/controller.interfaces.js";

/**
 * @file Reports Superbet provider errors.
 */

export const superbetConsoleHandlers: SuperbetHandlers = {
  onError(error, eventId) {
    console.error("Superbet:", { eventId, error });
  },
};
