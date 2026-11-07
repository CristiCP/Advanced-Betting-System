import type { BetanoEvent } from "../../providers/betano/model/state.interfaces.js";
import type { SuperbetEvent } from "../../providers/superbet/model/state.interfaces.js";
import type { UiEvent, UiSport } from "../model/ui.interfaces.js";

/** @file Reduces discovery lists to public identities without copying markets or account data. */

export function betanoUiEvents(events: BetanoEvent[]): UiEvent[] {
  const sports: Record<string, UiSport> = {
    FOOT: "football",
    BASK: "basketball",
    TENN: "tennis",
  };
  return events.flatMap((event) => {
    const sport = sports[event.sportId];
    if (!sport) return [];
    const names = event.participants
      ?.map((participant) => participant.name)
      .filter(Boolean);
    return [
      {
        provider: "betano" as const,
        sport,
        id: event.id,
        name: (names?.length
          ? names.join(" - ")
          : String(event.name ?? event.id)
        ).slice(0, 250),
      },
    ];
  });
}

export function superbetUiEvents(events: SuperbetEvent[]): UiEvent[] {
  const sports: Record<number, UiSport> = {
    5: "football",
    4: "basketball",
    2: "tennis",
  };
  return events.flatMap((event) => {
    const sport = sports[event.sportId];
    return sport
      ? [
          {
            provider: "superbet" as const,
            sport,
            id: event.id,
            name: event.name.slice(0, 250),
          },
        ]
      : [];
  });
}
