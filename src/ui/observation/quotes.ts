import type {
  UiProjection,
  UiProvider,
  UiQuoteMessage,
  UiWatchCommand,
} from "../model/ui.interfaces.js";

/** @file Publishes only the selected event, with one unacknowledged message at most. */

export class UiQuoteObserver {
  private watch: UiWatchCommand | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending = false;
  private lastSignature = "";
  private dirty = false;

  constructor(
    private readonly provider: UiProvider,
    private readonly read: (
      sport: "football" | "tennis",
      id: number,
    ) => UiProjection | null,
    private readonly send: (message: UiQuoteMessage) => void,
    private readonly intervalMs = 250,
    private readonly maxLines = 2_048,
  ) {}

  select(command: UiWatchCommand): void {
    this.closeTimer();
    this.watch = command.eventId === null ? null : command;
    this.lastSignature = "";
    this.dirty = true;
    if (this.watch !== null) {
      this.timer = setInterval(() => this.flush(), this.intervalMs);
      this.timer.unref();
      this.flush();
    }
  }

  acknowledge(): void {
    this.pending = false;
  }

  changed(sport: "football" | "tennis", eventId: number): void {
    if (this.watch?.sport === sport && this.watch.eventId === eventId)
      this.dirty = true;
  }

  close(): void {
    this.closeTimer();
    this.watch = null;
  }

  private closeTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private flush(): void {
    const watch = this.watch;
    if (watch === null || watch.eventId === null || this.pending || !this.dirty)
      return;
    try {
      const snapshot = this.read(watch.sport, watch.eventId);
      this.dirty = false;
      const signature =
        snapshot === null
          ? "missing"
          : `${snapshot.sourceVersion}:${snapshot.projectedAt}`;
      if (signature === this.lastSignature) return;
      const truncated =
        snapshot !== null && snapshot.lines.length > this.maxLines;
      const limited = truncated
        ? ({
            ...snapshot!,
            lines: snapshot!.lines.slice(0, this.maxLines),
          } as UiProjection)
        : snapshot;
      this.pending = true;
      this.send({
        type: "ui-quotes",
        provider: this.provider,
        generation: watch.generation,
        sport: watch.sport,
        eventId: watch.eventId,
        at: Date.now(),
        snapshot: limited,
        truncated,
      });
      this.lastSignature = signature;
    } catch {
      // Diagnostics must never stop provider processing.
      this.pending = false;
      this.close();
    }
  }
}
