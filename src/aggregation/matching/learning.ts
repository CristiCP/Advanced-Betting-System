import { readFile, rename, writeFile } from "node:fs/promises";
import type {
  AggregationLearnedTables,
  AggregationPair,
} from "../model/matching.interfaces.js";
import { isRecord } from "../protocol/validation.js";

/**
 * @file Learns name aliases and competition correspondences only from long-confirmed Betradar pairs.
 */

const maxEntries = 100_000;
const maxKeyLength = 512;

const isKey = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maxKeyLength;
const isId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

export function isLearnedTables(
  value: unknown,
): value is AggregationLearnedTables {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.aliases) &&
    value.aliases.length <= maxEntries &&
    value.aliases.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        isKey(entry[0]) &&
        isKey(entry[1]) &&
        entry[0] !== entry[1],
    ) &&
    Array.isArray(value.competitions) &&
    value.competitions.length <= maxEntries &&
    value.competitions.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        isId(entry[0]) &&
        isId(entry[1]),
    )
  );
}

export class LearnedTables {
  readonly aliases = new Map<string, Set<string>>();
  // Superbet competition -> Betano competition; contradictions remove the entry for good.
  private readonly competitions = new Map<number, number>();
  private readonly contradicted = new Set<number>();
  private aliasCount = 0;
  private dirty = false;
  private saving: Promise<void> | null = null;

  constructor(
    private readonly path: string | null,
    private readonly onError: (error: string) => void,
  ) {}

  get sizes(): { aliases: number; competitions: number } {
    return { aliases: this.aliasCount, competitions: this.competitions.size };
  }

  // A missing file is a fresh start; an invalid one is reported and ignored, never partially used.
  async load(): Promise<void> {
    if (this.path === null) return;
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.onError(`Learned tables could not be read: ${String(error)}`);
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = null;
    }
    if (!isLearnedTables(value)) {
      this.onError("Learned tables file is invalid and was ignored.");
      return;
    }
    for (const [a, b] of value.aliases) this.addAlias(a, b);
    for (const [superbet, betano] of value.competitions)
      this.addCompetition(superbet, betano);
    this.dirty = false;
  }

  competition(superbetId: number): number | undefined {
    return this.competitions.get(superbetId);
  }

  learn(pair: AggregationPair): void {
    const { superbet, betano } = pair;
    if (superbet.home.markers !== betano.home.markers) return;
    if (superbet.away.markers !== betano.away.markers) return;
    if (superbet.home.key !== betano.home.key)
      this.addAlias(superbet.home.key, betano.home.key);
    if (superbet.away.key !== betano.away.key)
      this.addAlias(superbet.away.key, betano.away.key);
    const left = superbet.identity.competitionId;
    const right = betano.identity.competitionId;
    if (left > 0 && right > 0) this.addCompetition(left, right);
  }

  // Write to a temporary file and rename, so a crash never leaves a truncated table.
  save(): Promise<void> {
    if (this.path === null || !this.dirty) return this.saving ?? Promise.resolve();
    const path = this.path;
    const tables: AggregationLearnedTables = {
      version: 1,
      aliases: [...this.aliases].flatMap(([a, targets]) =>
        [...targets].filter((b) => a < b).map((b): [string, string] => [a, b]),
      ),
      competitions: [...this.competitions],
    };
    this.dirty = false;
    const previous = this.saving ?? Promise.resolve();
    this.saving = previous
      .then(async () => {
        await writeFile(`${path}.tmp`, JSON.stringify(tables));
        await rename(`${path}.tmp`, path);
      })
      .catch((error: unknown) => {
        this.dirty = true;
        this.onError(`Learned tables could not be saved: ${String(error)}`);
      });
    return this.saving;
  }

  private addAlias(a: string, b: string): void {
    if (a === b || this.aliasCount >= maxEntries) return;
    if (this.aliases.get(a)?.has(b)) return;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const targets = this.aliases.get(from);
      if (targets) targets.add(to);
      else this.aliases.set(from, new Set([to]));
    }
    this.aliasCount++;
    this.dirty = true;
  }

  private addCompetition(superbet: number, betano: number): void {
    if (this.contradicted.has(superbet)) return;
    const known = this.competitions.get(superbet);
    if (known === betano) return;
    if (known !== undefined) {
      this.competitions.delete(superbet);
      this.contradicted.add(superbet);
    } else if (this.competitions.size < maxEntries)
      this.competitions.set(superbet, betano);
    this.dirty = true;
  }
}
