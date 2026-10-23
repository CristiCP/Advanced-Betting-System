/**
 * @file Identifies retryable Superbet HTTP failures without exposing response bodies.
 */

export class SuperbetHttpError extends Error {
  constructor(readonly statusCode: number) {
    super(`Superbet HTTP ${statusCode}.`);
  }
}
