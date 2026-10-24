import type { NormalizedTeam } from "../model/matching.interfaces.js";

/**
 * @file Normalizes team names and scores their similarity without guessing across squad markers.
 */

// Letters that NFKD does not decompose into a base letter plus a mark.
const letters: Record<string, string> = {
  ð: "d",
  đ: "d",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  ł: "l",
  ı: "i",
  þ: "th",
};

// Legal forms and connectors that carry no identity.
const ignored = new Set([
  "fc", "cf", "sc", "ac", "afc", "cd", "club", "fk", "sk", "sv", "ssc", "sd",
  "ud", "cs", "acs", "csm", "nk", "hnk", "bk", "if", "ik", "ff", "kv", "rsc",
  "ad", "ca", "ec", "clube", "esporte",
  "de", "da", "do", "la", "el", "the", "and", "y",
]);

const markerPatterns: [RegExp, (match: RegExpExecArray) => string][] = [
  [/\b(?:u|sub)-?(1[5-9]|2[0-3])\b/g, (match) => `u${match[1]}`],
  [/\(f\)|\(w\)|\bwomen\b|\bfeminin[ea]?\b|\bfemenin[oa]\b|\bladies\b|\bfem\b/g, () => "w"],
  [/\breserves?\b|\bres\b/g, () => "ii"],
  [/\bldd\b/g, () => "ldd"],
  [/\bacademy\b|\bacademia\b/g, () => "academy"],
];

export function foldText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[ðđßæœøłıþ]/g, (letter) => letters[letter]!);
}

export function normalizeTeam(name: string): NormalizedTeam {
  let text = foldText(name);
  const markers = new Set<string>();
  for (const [pattern, marker] of markerPatterns)
    text = text.replace(pattern, (...groups) => {
      markers.add(marker(groups as unknown as RegExpExecArray));
      return " ";
    });
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const tokens: string[] = [];
  for (const [index, word] of words.entries()) {
    // A trailing II/B/III names a second squad; anywhere else it is part of the name.
    if (index > 0 && index === words.length - 1 && /^(ii|iii|b)$/.test(word)) {
      markers.add(word === "b" ? "ii" : word);
      continue;
    }
    if (!ignored.has(word)) tokens.push(word);
  }
  // Keep something comparable when a name is made only of ignored words.
  if (tokens.length === 0) tokens.push(...words.filter((word) => word.length));
  return {
    tokens,
    key: tokens.join(" "),
    markers: [...markers].sort().join("|"),
  };
}

function isSubsequence(short: string, long: string): boolean {
  let index = 0;
  for (const char of long) if (char === short[index]) index++;
  return index === short.length;
}

function tokenScore(a: string, b: string): number {
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return 0.9;
  if (short.length >= 3 && short[0] === long[0] && isSubsequence(short, long))
    return 0.7;
  let prefix = 0;
  while (prefix < short.length && short[prefix] === long[prefix]) prefix++;
  if (prefix >= 4) return 0.7;
  return short.length >= 5 && withinOneEdit(short, long) ? 0.8 : 0;
}

// One substitution, insertion, or deletion: typical transliteration differences.
function withinOneEdit(short: string, long: string): boolean {
  if (long.length - short.length > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (short.length === long.length) i++;
    j++;
  }
  return edits + (long.length - j) + (short.length - i) <= 1;
}

const unmatchedCap = 0.4;
// Words left over on the longer name weigh half: "Alianza" vs "Alianza San Salvador".
const extraWeight = 0.5;

const initials = (tokens: string[]): string =>
  tokens.map((token) => token[0]).join("");

// Start of unused consecutive words whose initials spell the token (NY for New York), or -1.
function initialsRun(token: string, words: string[], used: Uint8Array): number {
  if (token.length < 2 || token.length > 4) return -1;
  for (let start = 0; start + token.length <= words.length; start++) {
    let index = 0;
    while (
      index < token.length &&
      !used[start + index] &&
      words[start + index]![0] === token[index]
    )
      index++;
    if (index === token.length) return start;
  }
  return -1;
}

// 0..1: token matches over the shorter name, with extra words of the longer name at half weight.
export function teamSimilarity(
  a: NormalizedTeam,
  b: NormalizedTeam,
  aliases?: ReadonlyMap<string, ReadonlySet<string>>,
): number {
  if (a.key === b.key || aliases?.get(a.key)?.has(b.key)) return 1;
  // Acronyms such as PSG for Paris Saint-Germain.
  for (const [short, long] of [
    [a, b],
    [b, a],
  ] as const)
    if (
      short.tokens.length === 1 &&
      long.tokens.length >= 2 &&
      short.key.length >= 2 &&
      short.key === initials(long.tokens)
    )
      return 0.9;
  const [fewer, more] =
    a.tokens.length <= b.tokens.length ? [a.tokens, b.tokens] : [b.tokens, a.tokens];
  if (fewer.length === 0) return 0;
  const used = new Uint8Array(more.length);
  let usedCount = 0;
  let total = 0;
  let unmatched = false;
  let weak = 0;
  for (const token of fewer) {
    const run = initialsRun(token, more, used);
    if (run >= 0) {
      used.fill(1, run, run + token.length);
      usedCount += token.length;
      total += 0.9;
      continue;
    }
    let best = 0;
    let bestIndex = -1;
    for (const [index, other] of more.entries()) {
      if (used[index]) continue;
      const score = tokenScore(token, other);
      if (score > best) {
        best = score;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) {
      used[bestIndex] = 1;
      usedCount++;
    }
    // Two-letter codes (SP, GO) never match on their own, and an unmatched one counts for neither side.
    if (best === 0 && token.length > 2) unmatched = true;
    else if (best === 0) weak++;
    total += best;
  }
  const counted = fewer.length - weak;
  if (counted === 0) return 0;
  const score = total / (counted + extraWeight * (more.length - usedCount));
  // A significant word with no counterpart (Rapid vs Dinamo) outweighs a shared city name.
  return unmatched ? Math.min(score, unmatchedCap) : score;
}
