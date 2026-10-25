import type {
  BetanoRecord,
  BetanoSnapshot,
} from "../model/state.interfaces.js";
import { isRecord } from "../processing/state.js";

/**
 * @file Aligns REST baselines with the event-and-markets SignalR audience.
 */

// Event data uses bit 1, incidents bit 2, and markets bit 4.
export const betanoEventAudience = 1 | 4;

export function eventAudienceSnapshot(value: BetanoRecord): BetanoSnapshot {
  if (
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 0 ||
    !isRecord(value.versionsPerAudience) ||
    !isRecord(value.event)
  )
    throw new Error("Betano snapshot is missing audience versions.");
  let total = 0;
  let version = 0;
  const entries = Object.entries(value.versionsPerAudience);
  if (entries.length === 0)
    throw new Error("Betano snapshot has empty audience versions.");
  for (const [key, count] of entries) {
    const audience = Number(key);
    if (
      !Number.isSafeInteger(audience) ||
      audience <= 0 ||
      audience > 255 ||
      String(audience) !== key ||
      !Number.isSafeInteger(count) ||
      (count as number) < 0
    )
      throw new Error("Invalid Betano audience version.");
    // Audience 8 has its own counter and is not part of the legacy full version.
    if (audience & 7) total += count as number;
    if (audience & betanoEventAudience) version += count as number;
  }
  if (!Number.isSafeInteger(total) || total !== value.version)
    throw new Error("Betano audience versions do not match the REST version.");
  const event = { ...value.event };
  // Incidents are not maintained by this subscription; never expose an old list as current.
  delete event.incidents;
  delete event.incidentFilters;
  return {
    ...value,
    event,
    restVersion: value.version,
    version,
  } as BetanoSnapshot;
}
