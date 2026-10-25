import type { BetanoOptions } from "../model/config.interfaces.js";
import type { BetanoSocketState } from "../model/feed.interfaces.js";

/**
 * @file Identifies repeated empty remote closes after a confirmed event subscription.
 */

export function shouldIsolateSocket(
  state: BetanoSocketState,
  options: BetanoOptions,
  error: string,
  now: number,
): boolean {
  if (state.failedAttempt === state.attempt) return false;
  state.failedAttempt = state.attempt;
  if (now - state.openedAt >= options.socketStableMs) state.failures = 0;
  // Opening failures, timeouts and local byte limits do not identify a poisoned subscription.
  if (
    state.events.size === 0 ||
    state.isolated ||
    !state.confirmedOnDisconnect ||
    error !== "WebSocket closed (1005)."
  )
    return false;
  state.failures++;
  return state.failures >= options.socketFailureThreshold;
}
