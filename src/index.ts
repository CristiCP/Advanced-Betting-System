import { threadId } from "node:worker_threads";
import { AggregationController } from "./aggregation/controller.js";
import { aggregationConsoleHandlers } from "./aggregation/logging.js";
import { BetanoController } from "./providers/betano/controller.js";
import { betanoConsoleHandlers } from "./providers/betano/logging.js";
import { SuperbetController } from "./providers/superbet/controller.js";
import { superbetConsoleHandlers } from "./providers/superbet/logging.js";
import { BettingController } from "./betting/controller.js";
import { UiController } from "./ui/controller.js";
import { uiConfig } from "./ui/config.js";
import { betanoUiEvents, superbetUiEvents } from "./ui/observation/events.js";

// The aggregator owns one direct port per provider and sport; providers keep running if it fails.
const betting = new BettingController();
const ui = new UiController();
const aggregation = new AggregationController(
  {},
  {
    onError(error, provider) {
      aggregationConsoleHandlers.onError?.(error, provider);
    },
    ...(uiConfig.enabled
      ? ({
          onMatches(matches) {
            ui.matches(matches);
          },
          onStatus(status) {
            ui.stats(status.stats);
          },
        } satisfies Pick<
          import("./aggregation/model/controller.interfaces.js").AggregationHandlers,
          "onMatches" | "onStatus"
        >)
      : {}),
    onOpportunity(report) {
      ui.opportunity(report);
      betting.onOpportunity(report);
    },
  },
);

// Give each provider independent network and processing workers.
const providers = [
  new BetanoController(
    {},
    {
      ...betanoConsoleHandlers,
      ...(uiConfig.enabled
        ? ({
            onEvents: (events) => ui.events("betano", betanoUiEvents(events)),
            onUiQuotes: (message) => ui.quote(message),
            onRemove: (eventId) => {
              betanoConsoleHandlers.onRemove?.(eventId);
              ui.remove("betano", eventId);
            },
          } satisfies Pick<
            import("./providers/betano/model/controller.interfaces.js").BetanoHandlers,
            "onEvents" | "onUiQuotes" | "onRemove"
          >)
        : {}),
    },
    aggregation.createPort("betano"),
    aggregation.createPort("betano", "tennis"),
  ),
  new SuperbetController(
    {},
    {
      ...superbetConsoleHandlers,
      ...(uiConfig.enabled
        ? ({
            onEvents: (events) =>
              ui.events("superbet", superbetUiEvents(events)),
            onUiQuotes: (message) => ui.quote(message),
            onRemove: (eventId) => {
              superbetConsoleHandlers.onRemove?.(eventId);
              ui.remove("superbet", eventId);
            },
          } satisfies Pick<
            import("./providers/superbet/model/controller.interfaces.js").SuperbetHandlers,
            "onEvents" | "onUiQuotes" | "onRemove"
          >)
        : {}),
    },
    aggregation.createPort("superbet"),
    aggregation.createPort("superbet", "tennis"),
  ),
];
ui.attach({ betano: providers[0]!, superbet: providers[1]! });

// Stop providers first so their outboxes close before the aggregator exits.
async function stop(): Promise<void> {
  await ui.stop();
  const results = await Promise.allSettled(
    providers.map((provider) => provider.stop()),
  );
  results.push(...(await Promise.allSettled([aggregation.stop()])));
  results.push(...(await Promise.allSettled([betting.stop()])));
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (errors.length)
    throw new AggregateError(errors, "Application shutdown failed.");
}

// Stop networking when Ctrl+C is pressed.
process.once("SIGINT", async () => {
  try {
    await stop();
  } catch (error) {
    console.error("Application shutdown failed:", error);
    process.exitCode = 1;
  }
});

// Start providers concurrently and release everything if a provider fails.
try {
  await Promise.all([
    aggregation
      .start()
      .catch((error: unknown) =>
        console.error("Aggregation startup failed:", error),
      ),
    ...providers.map((provider) => provider.start()),
  ]);
  console.log(`[Thread ${threadId}] Main ready (worker orchestration).`);
  await ui
    .start()
    .catch((error: unknown) => console.error("UI startup failed:", error));
} catch (error) {
  console.error("Application startup failed:", error);
  process.exitCode = 1;
  await stop().catch((failure: unknown) =>
    console.error("Application cleanup failed:", failure),
  );
}
