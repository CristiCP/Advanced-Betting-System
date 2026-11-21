/** @file Bounds supplemental football statistics traffic and local observation age. */

export const footballStatisticsConfig = {
  enabled: process.env.FOOTBALL_STATS_ENABLED !== "0",
  maxAgeMs: 15_000,
  intervalMs: 10_000,
  requestSpacingMs: 500,
  maxConcurrentPairs: 4,
  requestTimeoutMs: 4_000,
  maxResponseBytes: 1024 * 1024,
};
