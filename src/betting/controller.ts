import type {
  AggregationOpportunityLeg,
  AggregationOpportunityReport,
} from "../aggregation/model/opportunity.interfaces.js";
import { BetanoTaskAdapter } from "../tasks/adapters/betano.js";
import { SuperbetTaskAdapter } from "../tasks/adapters/superbet.js";
import { TaskController } from "../tasks/controller.js";
import type { TaskHandlers } from "../tasks/model/controller.interfaces.js";
import type { TaskAdapters } from "../tasks/model/executor.interfaces.js";
import type {
  TaskCategory,
  TaskEntry,
  TaskStats,
} from "../tasks/model/task.interfaces.js";
import {
  logBettingDecision,
  taskConsoleHandlers,
} from "../tasks/logging.js";
import {
  betanoBettingConfig,
  superbetBettingConfig,
} from "./config.js";

const retryMarginBps = 50;

interface FailedQuote {
  selectionId: string;
  expectedPrice: number;
}

interface ProviderExecutionState {
  currentTaskId: string | null;
  currentStatus: "pending" | "running" | null;
  sequence: number;
  done: boolean;
  succeeded: boolean;
  retryFrom: FailedQuote | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryReason: string | null;
}

interface OpportunityExecutionState {
  key: string;
  report: AggregationOpportunityReport;
  active: boolean;
  closed: boolean;
  providers: Record<TaskCategory, ProviderExecutionState>;
}

interface TaskOwner {
  opportunity: OpportunityExecutionState;
  category: TaskCategory;
}

const providerState = (): ProviderExecutionState => ({
  currentTaskId: null,
  currentStatus: null,
  sequence: 0,
  done: false,
  succeeded: false,
  retryFrom: null,
  retryTimer: null,
  retryReason: null,
});

export class BettingController {
  private readonly tasks: TaskController;
  private readonly versions = new Map<string, number>();
  private readonly opportunities = new Map<string, OpportunityExecutionState>();
  private readonly taskOwners = new Map<string, TaskOwner>();
  private readonly successful: Record<TaskCategory, number> = {
    betano: 0,
    superbet: 0,
  };
  private currentOpportunity: OpportunityExecutionState | null = null;

  constructor(
    adapters: TaskAdapters = {
      betano: new BetanoTaskAdapter(betanoBettingConfig),
      superbet: new SuperbetTaskAdapter(superbetBettingConfig),
    },
    private readonly limits: Readonly<Record<TaskCategory, number>> = {
      betano: betanoBettingConfig.maxAttempts,
      superbet: superbetBettingConfig.maxAttempts,
    },
    handlers: TaskHandlers = taskConsoleHandlers,
    private readonly retryWaitMs = 30_000,
  ) {
    this.tasks = new TaskController(adapters, {}, {
      onState: (task) => {
        handlers.onState?.(task);
        this.onTaskState(task);
      },
      onError: (error) => handlers.onError?.(error),
    });
  }

  onOpportunity(report: AggregationOpportunityReport): void {
    const key = `${report.sport ?? "football"}:${report.id}`;
    let opportunity = this.opportunities.get(key);
    if (opportunity === undefined) {
      opportunity = {
        key,
        report,
        active: false,
        closed: false,
        providers: {
          betano: providerState(),
          superbet: providerState(),
        },
      };
      this.opportunities.set(key, opportunity);
    }
    opportunity.report = report;

    if (report.kind === "pause" || report.kind === "close") {
      opportunity.active = false;
      opportunity.closed = report.kind === "close";
      for (const category of ["betano", "superbet"] as const) {
        const state = opportunity.providers[category];
        if (state.currentTaskId !== null)
          this.tasks.withdraw(state.currentTaskId);
        if (report.kind === "close" && state.retryFrom !== null) {
          if (category === "superbet" && this.canWaitForSuperbet(opportunity))
            this.beginSuperbetWait(opportunity, state.retryReason);
          else this.stopRetry(opportunity, category, this.closeReason(report));
        }
      }
      this.releaseIfIdle(opportunity);
      return;
    }

    opportunity.active = true;
    opportunity.closed = false;
    if (this.currentOpportunity === opportunity)
      this.drive(opportunity);
    else this.startNext();
  }

  getStats(): TaskStats {
    return this.tasks.getStats();
  }

  stop(): Promise<void> {
    for (const opportunity of this.opportunities.values())
      for (const state of Object.values(opportunity.providers))
        this.clearRetryWait(state);
    return this.tasks.stop();
  }

  private onTaskState(task: Readonly<TaskEntry>): void {
    if (!this.taskOwners.has(task.id)) return;
    const owner = this.taskOwners.get(task.id)!;
    const state = owner.opportunity.providers[owner.category];
    if (state.currentTaskId !== task.id) return;
    if (task.status === "pending" || task.status === "running") {
      state.currentStatus = task.status;
      return;
    }
    state.currentTaskId = null;
    state.currentStatus = null;

    if (task.status === "completed") {
      this.clearRetryWait(state);
      state.done = true;
      state.succeeded = true;
      state.retryFrom = null;
      this.successful[owner.category]++;
      this.drive(owner.opportunity);
      return;
    }
    if (task.status !== "failed") {
      this.releaseIfIdle(owner.opportunity);
      return;
    }

    state.retryFrom = {
      selectionId: task.payload.selectionId,
      expectedPrice: task.payload.expectedPrice,
    };
    state.retryReason = this.retryError(task.error);
    if (
      owner.category === "superbet" &&
      this.hasPlacedBetano(owner.opportunity) &&
      (owner.opportunity.active || this.canWaitForSuperbet(owner.opportunity))
    )
      this.beginSuperbetWait(owner.opportunity, state.retryReason);
    else if (owner.opportunity.closed)
      this.stopRetry(
        owner.opportunity,
        owner.category,
        this.closeReason(owner.opportunity.report),
      );
    this.drive(owner.opportunity);
  }

  private retry(
    opportunity: OpportunityExecutionState,
    category: TaskCategory,
  ): void {
    const state = opportunity.providers[category];
    const previous = state.retryFrom;
    if (previous === null || !opportunity.active || state.done) return;
    if (category === "superbet" && !this.hasPlacedBetano(opportunity)) {
      if (opportunity.providers.betano.done)
        this.stopRetry(
          opportunity,
          category,
          "Betano nu a fost plasat",
        );
      return;
    }
    const report = opportunity.report;
    if (report.marginBps < retryMarginBps) {
      this.stopRetry(
        opportunity,
        category,
        `marja actualizata ${this.margin(report.marginBps)} este sub 0.50%`,
      );
      return;
    }
    const leg = this.leg(report, category);
    if (leg === null) {
      this.stopRetry(opportunity, category, "selectia actualizata nu mai exista");
      return;
    }
    if (
      leg.selectionId === previous.selectionId &&
      leg.price === previous.expectedPrice
    )
      return;
    logBettingDecision(
      category,
      "RETRY",
      `${opportunity.key}:${category} | cota=${previous.expectedPrice} -> ${leg.price} | marja=${this.margin(report.marginBps)} | attempt=${state.sequence + 1}`,
    );
    this.clearRetryWait(state);
    state.retryFrom = null;
    this.submit(opportunity, category, true);
  }

  private submit(
    opportunity: OpportunityExecutionState,
    category: TaskCategory,
    retry: boolean,
  ): void {
    const state = opportunity.providers[category];
    if (
      category === "superbet" &&
      !retry &&
      !this.hasPlacedBetano(opportunity)
    )
      return;
    const leg = this.leg(opportunity.report, category);
    if (leg === null) {
      if (retry)
        this.stopRetry(opportunity, category, "selectia actualizata nu mai exista");
      else
        taskConsoleHandlers.onError?.(
          `Opportunity ${opportunity.report.id} has no ${category} selection ID.`,
        );
      if (!retry) {
        state.done = true;
        if (category === "betano") this.stopDependentSuperbet(opportunity);
      }
      return;
    }

    const creating = state.currentTaskId === null;
    if (!creating && state.currentStatus === "running") return;
    if (creating) {
      if (category === "superbet") this.clearRetryWait(state);
      state.sequence++;
      state.currentTaskId =
        state.sequence === 1
          ? `${opportunity.key}:${category}`
          : `${opportunity.key}:${category}:retry-${state.sequence}`;
      this.taskOwners.set(state.currentTaskId, { opportunity, category });
      state.currentStatus = "pending";
    }
    const id = state.currentTaskId!;
    const version = (this.versions.get(id) ?? 0) + 1;
    this.versions.set(id, version);
    const common = {
      opportunityId: opportunity.report.id,
      selectionId: leg.selectionId,
      expectedPrice: leg.price,
    };
    const result = this.tasks.submit(
      category === "betano"
        ? {
            id,
            category,
            version,
            payload: {
              provider: "betano",
              ...common,
              eventId: opportunity.report.betanoEventId,
            },
          }
        : {
            id,
            category,
            version,
            payload: {
              provider: "superbet",
              ...common,
              sport: opportunity.report.sport ?? "football",
              eventId: opportunity.report.superbetEventId,
              marketId: leg.marketId,
            },
          },
    );
    if (creating && result !== "created" && result !== "updated") {
      this.taskOwners.delete(id);
      state.currentTaskId = null;
      state.currentStatus = null;
      state.sequence--;
      state.done = true;
      if (category === "betano") this.stopDependentSuperbet(opportunity);
    }
  }

  private leg(
    report: AggregationOpportunityReport,
    category: TaskCategory,
  ): (AggregationOpportunityLeg & { selectionId: string }) | null {
    const leg = report.legs.find(
      (candidate) => candidate.provider === category,
    );
    return leg?.selectionId ? { ...leg, selectionId: leg.selectionId } : null;
  }

  private stopRetry(
    opportunity: OpportunityExecutionState,
    category: TaskCategory,
    reason: string,
  ): void {
    const state = opportunity.providers[category];
    if (state.done) return;
    state.done = true;
    this.clearRetryWait(state);
    state.retryFrom = null;
    logBettingDecision(
      category,
      "NOT RETRIED",
      `${opportunity.key}:${category} | reason=${reason}`,
    );
    if (category === "betano") this.stopDependentSuperbet(opportunity);
  }

  private advanceSuperbet(opportunity: OpportunityExecutionState): void {
    if (
      !this.hasPlacedBetano(opportunity) ||
      !this.canPlaceSuperbet(opportunity)
    )
      return;
    const state = opportunity.providers.superbet;
    if (state.done || state.currentTaskId !== null) return;
    if (opportunity.report.marginBps < retryMarginBps) {
      this.stopRetry(
        opportunity,
        "superbet",
        `marja actualizata ${this.margin(opportunity.report.marginBps)} este sub 0.50%`,
      );
      return;
    }
    if (!opportunity.active)
      logBettingDecision(
        "superbet",
        "HEDGE",
        `${opportunity.key}:superbet | Betano a fost plasat; oportunitatea s-a inchis la marja ${this.margin(opportunity.report.marginBps)}, se incearca acoperirea`,
      );
    if (state.retryFrom !== null) this.retry(opportunity, "superbet");
    else this.submit(opportunity, "superbet", false);
  }

  private canPlaceSuperbet(opportunity: OpportunityExecutionState): boolean {
    return (
      opportunity.active ||
      (opportunity.closed &&
        opportunity.report.reason === "margin" &&
        opportunity.report.marginBps >= retryMarginBps)
    );
  }

  private canWaitForSuperbet(opportunity: OpportunityExecutionState): boolean {
    return (
      this.hasPlacedBetano(opportunity) &&
      opportunity.closed &&
      (opportunity.report.reason === "margin" ||
        opportunity.report.reason === "suspended")
    );
  }

  private beginSuperbetWait(
    opportunity: OpportunityExecutionState,
    reason: string | null | undefined,
  ): void {
    const state = opportunity.providers.superbet;
    if (state.done) return;
    if (reason) state.retryReason = reason;
    if (state.retryTimer !== null) return;
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null;
      const detail = state.retryReason
        ? `; ultima eroare=${state.retryReason}`
        : "";
      this.stopRetry(
        opportunity,
        "superbet",
        `nu a aparut o cota noua in ${this.retryWaitMs / 1_000}s${detail}`,
      );
      this.releaseIfIdle(opportunity);
    }, this.retryWaitMs);
    logBettingDecision(
      "superbet",
      "WAITING",
      `${opportunity.key}:superbet | asteapta o cota noua maximum ${this.retryWaitMs / 1_000}s${reason ? ` | motiv=${reason}` : ""}`,
    );
  }

  private clearRetryWait(state: ProviderExecutionState): void {
    if (state.retryTimer !== null) clearTimeout(state.retryTimer);
    state.retryTimer = null;
    state.retryReason = null;
  }

  private retryError(error: string | undefined): string {
    if (!error) return "pariul a fost respins";
    if (error.includes("oddCoefficientChanged"))
      return "oddCoefficientChanged";
    if (error.includes("PlacementMarketInactive"))
      return "PlacementMarketInactive";
    return error.replace(/\s+/g, " ").slice(0, 240);
  }

  private stopDependentSuperbet(
    opportunity: OpportunityExecutionState,
  ): void {
    const state = opportunity.providers.superbet;
    if (state.done || state.currentTaskId !== null) return;
    this.stopRetry(
      opportunity,
      "superbet",
      "Betano nu a fost plasat",
    );
  }

  private hasPlacedBetano(opportunity: OpportunityExecutionState): boolean {
    return opportunity.providers.betano.succeeded;
  }

  private drive(opportunity: OpportunityExecutionState): void {
    if (this.currentOpportunity !== opportunity) return;
    const betano = opportunity.providers.betano;
    const superbet = opportunity.providers.superbet;
    if (betano.currentTaskId !== null || superbet.currentTaskId !== null) return;

    if (!betano.done) {
      if (!opportunity.active || !this.hasCapacityForNewOpportunity()) {
        this.releaseIfIdle(opportunity);
        return;
      }
      if (betano.retryFrom !== null) this.retry(opportunity, "betano");
      else this.submit(opportunity, "betano", false);
      this.releaseIfIdle(opportunity);
      return;
    }

    if (!betano.succeeded || superbet.done) {
      this.releaseIfIdle(opportunity);
      return;
    }
    if (
      !opportunity.active &&
      opportunity.closed &&
      opportunity.report.reason === "suspended" &&
      superbet.retryFrom === null
    ) {
      this.beginSuperbetWait(opportunity, "selectia este suspendata");
      return;
    }
    if (superbet.retryFrom !== null) this.retry(opportunity, "superbet");
    else this.advanceSuperbet(opportunity);
    this.releaseIfIdle(opportunity);
  }

  private startNext(): void {
    if (this.currentOpportunity !== null) return;
    for (const opportunity of this.opportunities.values()) {
      if (!this.canStart(opportunity)) continue;
      this.currentOpportunity = opportunity;
      this.drive(opportunity);
      return;
    }
  }

  private canStart(opportunity: OpportunityExecutionState): boolean {
    const betano = opportunity.providers.betano;
    const superbet = opportunity.providers.superbet;
    if (betano.currentTaskId !== null || superbet.currentTaskId !== null)
      return false;
    if (!betano.done) {
      if (!opportunity.active || !this.hasCapacityForNewOpportunity())
        return false;
      return this.retryIsActionable(opportunity, "betano");
    }
    if (!betano.succeeded || superbet.done || !this.canPlaceSuperbet(opportunity))
      return false;
    return this.retryIsActionable(opportunity, "superbet");
  }

  private retryIsActionable(
    opportunity: OpportunityExecutionState,
    category: TaskCategory,
  ): boolean {
    const previous = opportunity.providers[category].retryFrom;
    if (previous === null) return true;
    if (opportunity.report.marginBps < retryMarginBps) return true;
    const leg = this.leg(opportunity.report, category);
    return (
      leg === null ||
      leg.selectionId !== previous.selectionId ||
      leg.price !== previous.expectedPrice
    );
  }

  private releaseIfIdle(opportunity: OpportunityExecutionState): void {
    if (
      this.currentOpportunity !== opportunity ||
      opportunity.providers.betano.currentTaskId !== null ||
      opportunity.providers.superbet.currentTaskId !== null ||
      opportunity.providers.superbet.retryTimer !== null
    )
      return;
    this.currentOpportunity = null;
    this.startNext();
  }

  private hasCapacityForNewOpportunity(): boolean {
    return (
      this.successful.betano < this.limits.betano &&
      this.successful.superbet < this.limits.superbet
    );
  }

  private closeReason(report: AggregationOpportunityReport): string {
    return report.marginBps < retryMarginBps
      ? `marja actualizata ${this.margin(report.marginBps)} este sub 0.50%`
      : `oportunitatea nu mai este activa (${report.reason ?? "close"})`;
  }

  private margin(value: number): string {
    return `${value >= 0 ? "+" : ""}${(value / 100).toFixed(2)}%`;
  }
}
