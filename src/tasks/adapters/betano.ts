import { setTimeout as delay } from "node:timers/promises";
import { createSession } from "wreq-js";
import type { Session } from "wreq-js";
import type { BetanoBettingOptions } from "../../betting/model/config.interfaces.js";
import type { TaskAdapter } from "../model/executor.interfaces.js";
import { UncertainTaskError } from "../model/executor.interfaces.js";
import type { TaskPayload } from "../model/task.interfaces.js";

type JsonObject = Record<string, unknown>;

export class BetanoTaskAdapter implements TaskAdapter {
  private readonly origin: string;
  private session: Session | null = null;
  private connecting: Promise<Session> | null = null;

  constructor(private readonly options: BetanoBettingOptions) {
    const url = new URL(options.origin);
    if (!Number.isFinite(options.stake) || options.stake <= 0)
      throw new Error("Invalid Betano betting stake.");
    if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 0)
      throw new Error("Invalid Betano maximum attempt count.");
    this.origin = url.origin;
  }

  async execute(payload: TaskPayload, signal: AbortSignal): Promise<unknown> {
    if (payload.provider !== "betano")
      throw new Error("Betano adapter received another provider.");
    if (this.options.cookie.trim() === "")
      throw new Error("BETANO_COOKIE is not configured.");
    const session = await this.connect();
    signal.throwIfAborted();
    const plainLeg = this.betslip(
      await this.request(
        session,
        "POST",
        "/api/betslip/v3/plain-leg/",
        {
          selectionIds: [payload.selectionId],
          betslip: {
            hash: "",
            slipData: "",
            legs: [],
            bets: [],
            betslipTabId: 1,
            betslipTrackId: "",
          },
          eventId: String(payload.eventId),
          triggerPoint: { origin: 10, parentOrigin: 4 },
        },
        signal,
      ),
      "plain-leg",
    );
    const updated = this.betslip(
      await this.request(
        session,
        "PATCH",
        "/api/betslip/v3/updatebets",
        {
          betslip: plainLeg,
          bets: plainLeg.bets.map((bet) => ({
            ...bet,
            amount: this.options.stake,
            returns: 0,
          })),
        },
        signal,
      ),
      "updatebets",
    );
    try {
      let response = await this.request(
        session,
        "POST",
        "/api/betslip/v3/place",
        { betslip: { ...updated, oddschanges: "0" } },
        signal,
        true,
      );
      let data = response.data;
      if (isObject(data) && data.pending === true) {
        const uniqueId = data.uniqueId;
        const initialDelay = data.inPlayDelayMillis;
        if (
          typeof uniqueId !== "string" ||
          !/^\d+$/.test(uniqueId) ||
          typeof initialDelay !== "number" ||
          !Number.isSafeInteger(initialDelay) ||
          initialDelay < 0
        )
          throw new UncertainTaskError(
            "Betano returned an invalid pending placement.",
          );
        let delayMs: number = initialDelay;
        while (isObject(data) && data.pending === true) {
          await delay(Math.max(delayMs, 250), undefined, { signal });
          response = await this.request(
            session,
            "POST",
            `/api/betslip/v3/placed/${uniqueId}`,
            { betslip: updated },
            signal,
            true,
          );
          data = response.data;
          if (!isObject(data) || data.pending !== true) break;
          if (
            data.uniqueId !== undefined &&
            data.uniqueId !== uniqueId
          )
            throw new UncertainTaskError(
              "Betano changed the pending placement identity.",
            );
          const nextDelay = data.inPlayDelayMillis;
          if (nextDelay === undefined) delayMs = 0;
          else if (
            typeof nextDelay === "number" &&
            Number.isSafeInteger(nextDelay) &&
            nextDelay >= 0
          )
            delayMs = nextDelay;
          else
            throw new UncertainTaskError(
              "Betano returned an invalid pending delay.",
            );
        }
      }
      if (!isObject(data) || data.accepted !== true)
        throw new ConfirmedBetanoError(
          `Betano rejected the placement: ${jsonPreview(data ?? response)}`,
        );
      return data;
    } catch (error) {
      if (error instanceof ConfirmedBetanoError) throw error;
      throw new UncertainTaskError(
        `Betano place result is unknown: ${error instanceof Error ? error.message : String(error)}`,
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

  private async request(
    session: Session,
    method: "POST" | "PATCH",
    path: string,
    body: unknown,
    signal: AbortSignal,
    placement = false,
  ): Promise<JsonObject> {
    let received = false;
    try {
      const response = await session.fetch(`${this.origin}${path}`, {
        method,
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
          origin: this.origin,
          referer: `${this.origin}/live/`,
          "x-kbversion": "3.76.0",
        },
        body: JSON.stringify(body),
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
          `${method} ${path} returned invalid JSON (HTTP ${response.status}, content-type=${contentType}, body=${JSON.stringify(preview)}).`,
        );
      }
      if (!response.ok)
        throw new ConfirmedBetanoError(
          `${method} ${path} failed with HTTP ${response.status}.`,
        );
      if (!isObject(value))
        throw new Error(`${method} ${path} returned an invalid body.`);
      return value;
    } catch (error) {
      if (placement && received && !(error instanceof ConfirmedBetanoError))
        throw new UncertainTaskError(
          error instanceof Error ? error.message : String(error),
        );
      throw error;
    }
  }

  private betslip(
    response: JsonObject,
    operation: string,
  ): {
    hash: unknown;
    slipData: unknown;
    legs: unknown[];
    bets: JsonObject[];
    betslipTabId: unknown;
    betslipTrackId: unknown;
  } {
    const data = response.data;
    if (
      !isObject(data) ||
      !Array.isArray(data.legs) ||
      !Array.isArray(data.bets)
    )
      throw new Error(`${operation} response is missing betslip data.`);
    if (!data.bets.every(isObject))
      throw new Error(`${operation} response contains invalid bets.`);
    return {
      hash: data.hash ?? "",
      slipData: data.slipData ?? "",
      legs: data.legs,
      bets: data.bets,
      betslipTabId: data.betSlipTabId ?? data.betslipTabId ?? 1,
      betslipTrackId: data.betslipTrackId ?? "",
    };
  }
}

class ConfirmedBetanoError extends Error {}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 2_000);
  } catch {
    return String(value).slice(0, 2_000);
  }
}
