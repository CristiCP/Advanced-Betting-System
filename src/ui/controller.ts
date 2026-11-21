import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { AggregationMatchedEvent } from "../aggregation/model/matching.interfaces.js";
import type {
  FootballMarketChecks,
  FootballStatisticsView,
  FootballStatisticsWatch,
} from "../aggregation/model/football-statistics.interfaces.js";
import type { AggregationOpportunityReport } from "../aggregation/model/opportunity.interfaces.js";
import type { AggregationStats } from "../aggregation/model/worker.interfaces.js";
import { uiConfig } from "./config.js";
import type {
  UiChildMessage,
  UiEvent,
  UiFrame,
  UiOpportunity,
  UiOptions,
  UiProvider,
  UiProviderApi,
  UiQuoteMessage,
  UiSelection,
  UiSummary,
} from "./model/ui.interfaces.js";

/** @file Bridges bounded observation messages to an optional, independent UI process. */

export class UiController {
  private child: ChildProcess | null = null;
  private providers: Partial<Record<UiProvider, UiProviderApi>> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: { sequence: number; at: number } | null = null;
  private sequence = 0;
  private generation = 0;
  private selection: UiSelection | null = null;
  private viewers = false;
  private dirty = true;
  private selectionDirty = false;
  private summaryAt = 0;
  private reports: UiOpportunity[] = [];
  private quotes = new Map<UiProvider, UiQuoteMessage>();
  private footballChecks: FootballMarketChecks | undefined;
  private watchFootballStatistics:
    | ((watch: FootballStatisticsWatch | null) => void)
    | undefined;
  private dropped = 0;
  private stopping = false;
  private summary: UiSummary = {
    events: { betano: [], superbet: [] },
    counts: {
      betano: { football: 0, basketball: 0, tennis: 0 },
      superbet: { football: 0, basketball: 0, tennis: 0 },
    },
    matches: [],
    stats: null,
    at: 0,
    truncated: false,
  };

  constructor(private readonly options: UiOptions = uiConfig) {}

  attach(
    providers: Partial<Record<UiProvider, UiProviderApi>>,
    watchFootballStatistics?: (watch: FootballStatisticsWatch | null) => void,
  ): void {
    this.providers = providers;
    this.watchFootballStatistics = watchFootballStatistics;
  }

  footballStatistics(view: FootballStatisticsView): void {
    if (
      this.viewers &&
      this.selection?.sport === "football" &&
      view.generation === this.generation
    )
      this.footballChecks = view.checks;
  }

  events(provider: UiProvider, events: UiEvent[]): void {
    if (!this.options.enabled) return;
    const counts = { football: 0, basketball: 0, tennis: 0 };
    for (const event of events) counts[event.sport]++;
    this.summary.counts[provider] = counts;
    this.summary.events[provider] = events.slice(0, this.options.maxEvents);
    this.summary.truncated = Object.values(this.summary.counts).some(
      (sports) =>
        Object.values(sports).reduce((a, b) => a + b, 0) >
        this.options.maxEvents,
    );
    this.dirty = true;
  }

  matches(matches: AggregationMatchedEvent[]): void {
    this.summary.matches = matches.slice(0, this.options.maxEvents);
    this.dirty = true;
  }

  remove(provider: UiProvider, eventId: number): void {
    const events = this.summary.events[provider];
    const index = events.findIndex((event) => event.id === eventId);
    if (index === -1) return;
    const [removed] = events.splice(index, 1);
    this.summary.counts[provider][removed!.sport]--;
    this.dirty = true;
  }

  stats(stats: AggregationStats): void {
    this.summary.stats = stats;
    this.dirty = true;
  }

  opportunity(report: AggregationOpportunityReport): void {
    if (!this.options.enabled) return;
    const {
      kind,
      id,
      at,
      match,
      score,
      concept,
      line,
      marginBps,
      durationMs,
      reason,
      reasonDetail,
    } = report;
    this.reports.push({
      kind,
      id,
      at,
      match,
      score,
      concept,
      line,
      marginBps,
      durationMs,
      sport: report.sport ?? "football",
      legs: report.legs.map(({ provider, label, price }) => ({
        provider,
        label,
        price,
      })),
      ...(reason ? { reason } : {}),
      ...(reasonDetail ? { reasonDetail } : {}),
    });
    if (this.reports.length > this.options.historyLimit) {
      this.reports.shift();
      this.dropped++;
    }
  }

  quote(message: UiQuoteMessage): void {
    if (
      message.generation !== this.generation ||
      !this.viewers ||
      this.selection === null ||
      this.selection[message.provider] !== message.eventId ||
      this.selection.sport !== message.sport
    )
      return;
    this.quotes.set(message.provider, message);
  }

  async start(): Promise<string | null> {
    if (!this.options.enabled || this.child !== null || this.stopping)
      return null;
    if (
      !Number.isInteger(this.options.port) ||
      this.options.port < 0 ||
      this.options.port > 65535
    ) {
      console.error("UI disabled: invalid UI_PORT.");
      return null;
    }
    const child = fork(new URL("./server/process.js", import.meta.url), [], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      serialization: "advanced",
      execArgv: ["--enable-source-maps"],
      env: { ...process.env, UI_SERVER_OPTIONS: JSON.stringify(this.options) },
    });
    this.child = child;
    child.on("error", (error) => this.fail(String(error)));
    child.once("exit", () => {
      if (this.child === child) this.fail("UI process exited.");
    });
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.fail("UI startup timed out.");
        resolve(null);
      }, 5_000);
      child.on("message", (value: UiChildMessage) => {
        if (value.type === "ready") {
          clearTimeout(timeout);
          this.timer = setInterval(
            () => this.flush(),
            this.options.quoteIntervalMs,
          );
          this.timer.unref();
          console.log(`[UI] ${value.url}`);
          resolve(value.url ?? null);
        } else if (
          value.type === "ack" &&
          value.sequence === this.inFlight?.sequence
        ) {
          this.inFlight = null;
        } else if (value.type === "viewers") {
          this.viewers = value.connected === true;
          this.dirty = true;
          if (!this.viewers) this.select(null);
        } else if (value.type === "watch") {
          this.select(value.selection ?? null);
        } else if (value.type === "error") {
          clearTimeout(timeout);
          this.fail(value.error ?? "UI failed.");
          resolve(null);
        }
      });
    });
  }

  private select(selection: UiSelection | null): void {
    this.selection = selection;
    this.generation++;
    this.selectionDirty = true;
    this.quotes.clear();
    this.footballChecks = undefined;
    const { superbet, betano } = selection ?? {};
    try {
      this.watchFootballStatistics?.(
        selection?.sport === "football" &&
          superbet !== undefined &&
          betano !== undefined
          ? {
              generation: this.generation,
              superbetId: superbet,
              betanoId: betano,
            }
          : null,
      );
    } catch (error) {
      console.error("UI statistics observation failed:", error);
    }
    for (const provider of ["superbet", "betano"] as const) {
      try {
        this.providers[provider]?.watchUi({
          type: "ui-watch",
          generation: this.generation,
          sport: selection?.sport ?? "football",
          eventId: selection?.[provider] ?? null,
        });
      } catch (error) {
        console.error("UI observation failed:", error);
      }
    }
  }

  private flush(): void {
    if (this.inFlight !== null) {
      if (Date.now() - this.inFlight.at > 5_000)
        this.fail("UI observation stalled; disabled.");
      return;
    }
    const child = this.child;
    if (child === null || !child.connected || !this.viewers) return;
    const now = Date.now();
    const includeSummary =
      this.dirty && now - this.summaryAt >= this.options.summaryIntervalMs;
    if (
      !includeSummary &&
      !this.selectionDirty &&
      this.quotes.size === 0 &&
      this.footballChecks === undefined &&
      this.reports.length === 0
    )
      return;
    const frame: UiFrame = {
      type: "frame",
      sequence: ++this.sequence,
      generation: this.generation,
      selection: this.selection,
      opportunities: this.reports,
      dropped: this.dropped,
      ...(includeSummary ? { summary: { ...this.summary, at: now } } : {}),
      ...(this.quotes.size ? { quotes: [...this.quotes.values()] } : {}),
      ...(this.footballChecks !== undefined
        ? { footballChecks: this.footballChecks }
        : {}),
    };
    this.reports = [];
    this.quotes.clear();
    this.footballChecks = undefined;
    this.selectionDirty = false;
    if (includeSummary) {
      this.dirty = false;
      this.summaryAt = now;
    }
    this.inFlight = { sequence: frame.sequence, at: now };
    try {
      child.send(frame, (error) => {
        if (error) this.fail(String(error));
      });
    } catch (error) {
      this.fail(String(error));
    }
  }

  private fail(error: string): void {
    const child = this.child;
    this.child = null;
    this.inFlight = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.viewers = false;
    this.select(null);
    child?.kill();
    if (!this.stopping) console.error("UI disabled:", error);
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const child = this.child;
    this.fail("stopped");
    if (
      child !== null &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }
}
