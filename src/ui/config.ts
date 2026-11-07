import type { UiOptions } from "./model/ui.interfaces.js";

/** @file Bounds the local read-only dashboard and its observation traffic. */

export const uiConfig: UiOptions = {
  enabled: process.env.UI_ENABLED !== "0",
  port: Number(process.env.UI_PORT ?? 4310),
  summaryIntervalMs: 1_000,
  quoteIntervalMs: 250,
  historyLimit: 500,
  maxLines: 2_048,
  maxEvents: 10_000,
  maxFrameBytes: 4 * 1024 * 1024,
};
