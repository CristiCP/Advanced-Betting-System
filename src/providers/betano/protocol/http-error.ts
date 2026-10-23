/**
 * @file Carries server retry deadlines without retrying rejected requests immediately.
 */

export class BetanoHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly retryAfterMs: number,
  ) {
    super(`Betano returned HTTP ${statusCode}.`);
  }
}
