import { randomUUID } from "node:crypto";
import { createSession } from "wreq-js";
import type { Session } from "wreq-js";
import type { SuperbetBettingOptions } from "../../betting/model/config.interfaces.js";
import type { TaskAdapter } from "../model/executor.interfaces.js";
import { UncertainTaskError } from "../model/executor.interfaces.js";
import type {
  SuperbetBetTaskPayload,
  TaskPayload,
} from "../model/task.interfaces.js";

type JsonObject = Record<string, unknown>;

interface OfferSelection {
  fixture: JsonObject;
  market: JsonObject;
  odd: JsonObject;
  metadata: JsonObject;
}

interface StructureNames {
  sports: Map<number, string>;
  categories: Map<number, string>;
  tournaments: Map<number, string>;
}

export class SuperbetTaskAdapter implements TaskAdapter {
  private readonly origin: string;
  private readonly siteOrigin: string;
  private readonly offerOrigin: string;
  private readonly deviceIdentifier = randomUUID();
  private session: Session | null = null;
  private connecting: Promise<Session> | null = null;
  private structure: Promise<StructureNames> | null = null;

  constructor(private readonly options: SuperbetBettingOptions) {
    this.origin = new URL(options.origin).origin;
    this.siteOrigin = new URL(options.siteOrigin).origin;
    this.offerOrigin = new URL(options.offerOrigin).origin;
    if (!Number.isFinite(options.stake) || options.stake <= 0)
      throw new Error("Invalid Superbet betting stake.");
    if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 0)
      throw new Error("Invalid Superbet maximum attempt count.");
  }

  async execute(payload: TaskPayload, signal: AbortSignal): Promise<unknown> {
    if (payload.provider !== "superbet")
      throw new Error("Superbet adapter received another provider.");
    if (
      this.options.cookie.trim() === "" ||
      this.options.cookie === "PASTE_SUPERBET_BETA_COOKIE_HERE"
    )
      throw new Error("Superbet betting cookie is not configured.");
    const session = await this.connect();
    signal.throwIfAborted();
    const [selection, names] = await Promise.all([
      this.loadSelection(session, payload, signal),
      this.loadStructure(session, signal),
    ]);
    const body = this.ticket(payload, selection, names);

    try {
      const response = await this.request(
        session,
        "POST",
        `${this.origin}/betting/submitTicket?clientSourceType=Desktop_new`,
        body,
        signal,
        true,
      );
      const data = response.data;
      const ticketData = isObject(data) ? data.ticketData : undefined;
      const status = isObject(ticketData) ? ticketData.status : undefined;
      if (
        response.code !== 0 ||
        response.error !== false ||
        !isObject(data) ||
        typeof data.ticketId !== "string" ||
        data.ticketId === "" ||
        status !== "approved"
      ) {
        if (status !== undefined && status !== "approved")
          throw new ConfirmedSuperbetError(
            `Superbet rejected the placement: ${jsonPreview(response)}`,
          );
        if (response.error === true || response.code !== 0)
          throw new ConfirmedSuperbetError(
            `Superbet rejected the placement: ${jsonPreview(response)}`,
          );
        throw new UncertainTaskError(
          `Superbet returned an unconfirmed placement: ${jsonPreview(response)}`,
        );
      }
      return data;
    } catch (error) {
      if (
        error instanceof ConfirmedSuperbetError ||
        error instanceof UncertainTaskError
      )
        throw error;
      throw new UncertainTaskError(
        `Superbet place result is unknown: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async close(): Promise<void> {
    await this.connecting?.catch(() => {});
    await this.session?.close();
    this.session = null;
  }

  private async connect(): Promise<Session> {
    this.connecting ??= (async () => {
      const session = await createSession({
        browser: "chrome_149",
        os: "windows",
      });
      for (const part of this.options.cookie.split(";")) {
        const separator = part.indexOf("=");
        if (separator <= 0) continue;
        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (name) session.setCookie(name, value, this.origin);
      }
      this.session = session;
      return session;
    })();
    return this.connecting;
  }

  private async loadSelection(
    session: Session,
    payload: SuperbetBetTaskPayload,
    signal: AbortSignal,
  ): Promise<OfferSelection> {
    const query = new URLSearchParams({
      events: String(payload.eventId),
      markets: String(payload.marketId),
    });
    const response = await this.request(
      session,
      "GET",
      `${this.offerOrigin}/v3/ro-RO/events?${query}`,
      undefined,
      signal,
    );
    const events = response.events;
    const event = Array.isArray(events)
      ? events.find(
          (candidate) =>
            isObject(candidate) && candidate.event_id === payload.eventId,
        )
      : undefined;
    if (!isObject(event) || !isObject(event.fixture))
      throw new Error("Superbet offer response is missing the event.");
    const markets = event.markets;
    const market = Array.isArray(markets)
      ? markets.find(
          (candidate) =>
            isObject(candidate) && candidate.id === payload.marketId,
        )
      : undefined;
    if (!isObject(market) || !Array.isArray(market.odds))
      throw new Error("Superbet offer response is missing the market.");
    const odd = market.odds.find(
      (candidate) =>
        isObject(candidate) && candidate.uuid === payload.selectionId,
    );
    if (!isObject(odd) || !isObject(odd.metadata))
      throw new Error("Superbet offer response is missing the selection.");
    return { fixture: event.fixture, market, odd, metadata: odd.metadata };
  }

  private loadStructure(
    session: Session,
    signal: AbortSignal,
  ): Promise<StructureNames> {
    this.structure ??= this.request(
      session,
      "GET",
      `${this.offerOrigin}/v2/ro-RO/struct`,
      undefined,
      signal,
    ).then((response) => {
      const data = response.data;
      if (!isObject(data))
        throw new Error("Superbet structure response is missing data.");
      return {
        sports: names(data.sports),
        categories: names(data.categories),
        tournaments: names(data.tournaments),
      };
    });
    return this.structure;
  }

  private ticket(
    payload: SuperbetBetTaskPayload,
    selection: OfferSelection,
    names: StructureNames,
  ): JsonObject {
    const { fixture, market, odd, metadata } = selection;
    const eventName = requiredText(fixture.event_name, "event name");
    const teams = eventName.split("\u00b7");
    if (teams.length !== 2 || !teams[0] || !teams[1])
      throw new Error("Superbet event has invalid participants.");
    const sportId = requiredInteger(fixture.sport_id, "sport ID");
    const tournamentId = requiredInteger(
      fixture.tournament_id,
      "tournament ID",
    );
    const categoryId = requiredInteger(fixture.category_id, "category ID");
    const outcomeId = requiredInteger(metadata.outcome_id, "outcome ID");
    const eventDate = bucharestDate(
      requiredText(fixture.utc_date, "event date"),
    );
    const categoryName = names.categories.get(categoryId) ?? "";
    const fullTournamentName = names.tournaments.get(tournamentId) ?? "";
    const tournamentName = fullTournamentName.startsWith(`${categoryName} - `)
      ? fullTournamentName.slice(categoryName.length + 3)
      : fullTournamentName;
    const oddName = requiredText(metadata.name, "selection name");
    const oddUuid = requiredText(odd.uuid, "selection UUID");
    const deviceIdentifier = this.deviceIdentifier;
    return {
      ticketOnline: "online",
      total: this.options.stake,
      betType: "prematch",
      combs: "",
      items: [
        {
          value: String(payload.expectedPrice),
          type: "sport",
          fix: false,
          betRadarId: requiredText(fixture.betradar_id, "Betradar ID"),
          eventId: payload.eventId,
          eventUuid: requiredText(fixture.uuid, "event UUID"),
          oddUuid,
          sourceType: 101,
          sourceScreen: 803,
          betGroupId: payload.marketId,
          eventName,
          eventCode: requiredInteger(fixture.event_code, "event code"),
          live: true,
          marketId: payload.marketId,
          marketName: requiredText(market.name, "market name"),
          marketUuid: requiredText(
            metadata.market_line_uuid,
            "market UUID",
          ),
          matchDate: eventDate,
          matchDateUtc: eventDate,
          matchId: payload.eventId,
          matchName: eventName,
          oddCode: optionalText(metadata.code),
          oddDescription: requiredText(
            metadata.info,
            "selection description",
          ),
          oddFullName: oddName,
          oddId: outcomeId,
          oddName,
          oddTypeId: outcomeId,
          rules: [],
          sbValue:
            typeof metadata.special_bet_value === "string"
              ? metadata.special_bet_value
              : "",
          selected: true,
          sportId,
          sportName: names.sports.get(sportId) ?? "",
          teamId1: requiredText(fixture.home_team_id, "home team ID"),
          teamId2: requiredText(fixture.away_team_id, "away team ID"),
          teamnameone: teams[0],
          teamnametwo: teams[1],
          tournamentId,
          tournamentName,
          uuid: oddUuid,
        },
      ],
      clientSourceType: "Desktop_new",
      paymentBonusType: 1,
      locale: "ro-RO",
      requestDetails: {
        ldAnonymousUserKey: `ANONYMOUS_USER-${deviceIdentifier.slice(0, 8)}`,
        deviceId: deviceIdentifier,
        isDeviceIdTestFlagOnSubscribed: "true",
        isDeviceIdTestFlagOnInitial: "true",
      },
      geoLocation: "develop",
      deviceIdentifier,
      autoAcceptChanges: "0",
      ticketUuid: randomUUID(),
    };
  }

  private async request(
    session: Session,
    method: "GET" | "POST",
    url: string,
    body: unknown,
    signal: AbortSignal,
    placement = false,
  ): Promise<JsonObject> {
    let received = false;
    try {
      const response = await session.fetch(url, {
        method,
        headers: {
          accept: "application/json, text/plain, */*",
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
          origin: this.siteOrigin,
          referer: `${this.siteOrigin}/`,
          ...(method === "POST" ? { "x-sb-wallet-override": "betler" } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal,
        redirect: "manual",
      });
      received = true;
      const text = await response.text();
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        const contentType = response.headers.get("content-type") ?? "unknown";
        const preview = text.replace(/\s+/g, " ").trim().slice(0, 2_000);
        throw new Error(
          `${method} ${new URL(url).pathname} returned invalid JSON (HTTP ${response.status}, content-type=${contentType}, body=${JSON.stringify(preview)}).`,
        );
      }
      if (!response.ok)
        throw new ConfirmedSuperbetError(
          `${method} ${new URL(url).pathname} failed with HTTP ${response.status}: ${jsonPreview(value)}`,
        );
      if (!isObject(value))
        throw new Error(`${method} ${new URL(url).pathname} returned an invalid body.`);
      return value;
    } catch (error) {
      if (
        placement &&
        received &&
        !(error instanceof ConfirmedSuperbetError)
      )
        throw new UncertainTaskError(
          error instanceof Error ? error.message : String(error),
        );
      throw error;
    }
  }
}

class ConfirmedSuperbetError extends Error {}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, label: string): string {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).trim() === ""
  )
    throw new Error(`Superbet offer has no ${label}.`);
  return String(value);
}

function optionalText(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function requiredInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new Error(`Superbet offer has no ${label}.`);
  return value as number;
}

function names(value: unknown): Map<number, string> {
  const result = new Map<number, string>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!isObject(item) || !isObject(item.localNames)) continue;
    const id = Number(item.id);
    const name = item.localNames["ro-RO"];
    if (Number.isSafeInteger(id) && id > 0 && typeof name === "string")
      result.set(id, name);
  }
  return result;
}

function bucharestDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Superbet offer has an invalid event date.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function jsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 2_000);
  } catch {
    return String(value).slice(0, 2_000);
  }
}
