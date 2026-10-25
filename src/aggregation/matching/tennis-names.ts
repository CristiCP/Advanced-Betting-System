import type { NormalizedTeam } from "../model/matching.interfaces.js";

/**
 * @file Compares tennis participants without football token removal or cross-player doubles mixing.
 */

function members(name: string): string[][] {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split("/")
    .map((member) =>
      member
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    );
}

export function normalizeTennisParticipant(name: string): NormalizedTeam {
  const sides = members(name);
  return {
    tokens: sides.flat(),
    key: sides
      .map((side) => side.slice().sort().join(" "))
      .sort()
      .join("/"),
    markers: `tennis:${sides.length}`,
  };
}

function memberSimilarity(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const used = new Set<number>();
  let matched = 0,
    full = 0;
  // Full tokens claim their partners before initials can consume them.
  for (const token of [...a].sort((x, y) => y.length - x.length)) {
    let at = b.findIndex((other, i) => !used.has(i) && token === other);
    if (at >= 0) {
      if (token.length >= 3) full++;
    } else
      at = b.findIndex(
        (other, i) =>
          !used.has(i) &&
          ((token.length === 1 && other.startsWith(token)) ||
            (other.length === 1 && token.startsWith(other))),
      );
    if (at >= 0) {
      used.add(at);
      matched++;
    }
  }
  return full ? (2 * matched) / (a.length + b.length) : 0;
}

export function tennisNameSimilarity(
  a: NormalizedTeam,
  b: NormalizedTeam,
): number {
  const left = a.key.split("/").map((part) => part.split(" ")),
    right = b.key.split("/").map((part) => part.split(" "));
  if (left.length !== right.length || left.length > 2) return 0;
  if (left.length === 1) return memberSimilarity(left[0]!, right[0]!);
  return Math.max(
    Math.min(
      memberSimilarity(left[0]!, right[0]!),
      memberSimilarity(left[1]!, right[1]!),
    ),
    Math.min(
      memberSimilarity(left[0]!, right[1]!),
      memberSimilarity(left[1]!, right[0]!),
    ),
  );
}
