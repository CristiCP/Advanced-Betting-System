import type {
  AggregationEvent,
  AggregationPair,
} from "../model/matching.interfaces.js";
import type { QuoteBook } from "../processing/quotes.js";

/**
 * @file Links equal canonical lines of confirmed pairs through the peer arrays of both quote books.
 */

export interface LineLinkerHandlers {
  onLinked(superbetLine: number): void;
  onUnlinked(superbetLine: number): void;
}

export class LineLinker {
  constructor(
    private readonly superbet: QuoteBook,
    private readonly betano: QuoteBook,
    private readonly handlers: LineLinkerHandlers,
  ) {}

  // Walk the smaller line map and probe the other: O(min(n, m)).
  link(pair: AggregationPair): void {
    const small =
      pair.superbet.lines.size <= pair.betano.lines.size
        ? pair.superbet
        : pair.betano;
    const large = small === pair.superbet ? pair.betano : pair.superbet;
    for (const [key, line] of small.lines) {
      const other = large.lines.get(key);
      if (other === undefined) continue;
      if (small === pair.superbet) this.connect(pair, line, other);
      else this.connect(pair, other, line);
    }
  }

  unlink(pair: AggregationPair): void {
    for (const line of pair.links) {
      const peer = this.superbet.peer[line]!;
      this.superbet.peer[line] = -1;
      if (peer >= 0) this.betano.peer[peer] = -1;
      this.handlers.onUnlinked(line);
    }
    pair.links.clear();
  }

  lineDefined(event: AggregationEvent, key: number, line: number): void {
    const pair = event.pair;
    if (pair === null || pair.state !== "confirmed") return;
    if (event.provider === "superbet") {
      const other = pair.betano.lines.get(key);
      if (other !== undefined) this.connect(pair, line, other);
    } else {
      const other = pair.superbet.lines.get(key);
      if (other !== undefined) this.connect(pair, other, line);
    }
  }

  lineReleased(event: AggregationEvent, line: number): void {
    const superbetLine =
      event.provider === "superbet" ? line : this.betano.peer[line]!;
    if (superbetLine < 0) return;
    const betanoLine = this.superbet.peer[superbetLine]!;
    if (betanoLine < 0) return;
    this.superbet.peer[superbetLine] = -1;
    this.betano.peer[betanoLine] = -1;
    event.pair?.links.delete(superbetLine);
    this.handlers.onUnlinked(superbetLine);
  }

  private connect(
    pair: AggregationPair,
    superbetLine: number,
    betanoLine: number,
  ): void {
    this.superbet.peer[superbetLine] = betanoLine;
    this.betano.peer[betanoLine] = superbetLine;
    pair.links.add(superbetLine);
    this.handlers.onLinked(superbetLine);
  }
}
