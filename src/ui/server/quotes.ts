import { betanoFootballMarkets } from "../../providers/betano/football-markets.config.js";
import { betanoTennisMarkets } from "../../providers/betano/tennis-markets.config.js";
import { superbetFootballMarkets } from "../../providers/superbet/football-markets.config.js";
import { superbetTennisMarkets } from "../../providers/superbet/tennis-markets.config.js";
import { isRoleA } from "../../aggregation/mapping.js";
import { canonicalLines } from "./canonical.js";
import type {
  UiQuoteMessage,
  UiQuoteRow,
  UiQuoteView,
} from "../model/ui.interfaces.js";

/** @file Formats filtered public quotes exclusively inside the UI process. */

const catalogs = {
  betano: {
    football: new Map<number, string>(
      betanoFootballMarkets.map((m) => [m.typeId, m.nameTemplate]),
    ),
    tennis: new Map<number, string>(
      betanoTennisMarkets.map((m) => [m.typeId, m.nameTemplate]),
    ),
  },
  superbet: {
    football: new Map(
      superbetFootballMarkets.map((m) => [m.id, m.nameTemplate]),
    ),
    tennis: new Map(superbetTennisMarkets.map((m) => [m.id, m.nameTemplate])),
  },
};

export function quoteView(message: UiQuoteMessage): UiQuoteView {
  const snapshot = message.snapshot;
  if (snapshot === null)
    return {
      provider: message.provider,
      eventId: message.eventId,
      at: message.at,
      synchronized: false,
      rows: [] as UiQuoteRow[],
      truncated: message.truncated,
    };
  const event = snapshot.event;
  const home = "home" in event ? event.home.name : event.player1.name;
  const away = "away" in event ? event.away.name : event.player2.name;
  const suspended =
    "isSuspended" in event ? event.isSuspended : event.offerStatus !== 1;
  const canonical = canonicalLines(message);
  const rows: UiQuoteRow[] = snapshot.lines.map((line) => {
    const type = "marketTypeId" in line ? line.marketTypeId : line.marketId;
    const set = "setNumber" in line ? line.setNumber : null;
    const game = "gameNumber" in line ? line.gameNumber : null;
    const replacements: Record<string, string> = {
      HOME: home,
      AWAY: away,
      HOME_TEAM: home,
      AWAY_TEAM: away,
      TEAM_1: home,
      TEAM_2: away,
      PLAYER_1: home,
      PLAYER_2: away,
      SET: String(set ?? "?"),
      GAME: String(game ?? "?"),
      TOTAL: String(line.total ?? ""),
      HANDICAP: String(line.handicap ?? ""),
      FROM: "fromMinute" in line ? String(line.fromMinute ?? "?") : "?",
      TO: "toMinute" in line ? String(line.toMinute ?? "?") : "?",
    };
    const market = (
      catalogs[message.provider][message.sport].get(type) ?? `Market ${type}`
    ).replace(
      /<([A-Z_0-9]+)>/g,
      (original, key: string) => replacements[key] ?? original,
    );
    const coordinates = [
      line.total !== null ? `total ${line.total}` : null,
      line.handicap !== null ? `hcp ${line.handicap}` : null,
      set !== null ? `set ${set}` : null,
      game !== null ? `game ${game}` : null,
      "fromMinute" in line && line.fromMinute !== null
        ? `${line.fromMinute}–${line.toMinute ?? "?"} min`
        : null,
      "firstMinutes" in line && line.firstMinutes !== null
        ? `primele ${line.firstMinutes} min`
        : null,
      "interval" in line && line.interval !== null
        ? `${line.interval.fromSecond}–${line.interval.toSecond}s`
        : null,
      "scoreContext" in line && line.scoreContext !== null
        ? `scor ${line.scoreContext.home}:${line.scoreContext.away}`
        : null,
    ]
      .filter((value) => value !== null)
      .join(" · ");
    return {
      key: `${message.provider}:${line.key}`,
      provider: message.provider,
      market,
      marketId: line.marketId,
      line: coordinates || "—",
      canonicalKey: canonical.get(line.key)?.key ?? null,
      concept:
        canonical
          .get(line.key)
          ?.concept.replace(
            /<([A-Z_0-9]+)>/g,
            (original, key: string) => replacements[key] ?? original,
          ) ?? null,
      selections: [...line.selections]
        .sort((a, b) => Number(isRoleA(b.role)) - Number(isRoleA(a.role)))
        .map((selection) => ({
          label:
            (
              {
                home,
                away,
                player1: home,
                player2: away,
                over: "Peste",
                under: "Sub",
                yes: "Da",
                no: "Nu",
              } as Record<string, string>
            )[selection.role] ?? selection.role,
          price: selection.price,
          available:
            !suspended &&
            snapshot.synchronized !== false &&
            event.phase === "live" &&
            selection.price !== null &&
            selection.price > 1 &&
            ("isSuspended" in selection
              ? !selection.isSuspended &&
                !("isSuspended" in line && line.isSuspended)
              : selection.status === 1 && selection.display),
        })),
    };
  });
  return {
    provider: message.provider,
    eventId: message.eventId,
    name: `${home} - ${away}`,
    at: message.at,
    projectedAt: snapshot.projectedAt,
    sourceVersion: snapshot.sourceVersion,
    synchronized: snapshot.synchronized !== false,
    suspended,
    truncated: message.truncated,
    score:
      "homeScore" in event
        ? `${event.homeScore ?? "?"}:${event.awayScore ?? "?"}`
        : `seturi ${event.player1Sets ?? "?"}:${event.player2Sets ?? "?"} · puncte ${event.player1Points ?? "?"}:${event.player2Points ?? "?"} · serviciu ${event.serving ?? "?"}`,
    rows,
  };
}
