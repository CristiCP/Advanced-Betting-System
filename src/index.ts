import { AggregationController } from "./aggregation/controller.js";
import { aggregationConsoleHandlers } from "./aggregation/logging.js";
import { BetanoController } from "./providers/betano/controller.js";
import { betanoConsoleHandlers } from "./providers/betano/logging.js";
import { SuperbetController } from "./providers/superbet/controller.js";
import { superbetConsoleHandlers } from "./providers/superbet/logging.js";

// The aggregator owns one direct port per provider; providers keep running if it fails.
const aggregation = new AggregationController({}, aggregationConsoleHandlers);

// Give each provider independent network and processing workers.
const providers = [
  new BetanoController(
    {},
    betanoConsoleHandlers,
    aggregation.createPort("betano"),
  ),
  new SuperbetController(
    {},
    superbetConsoleHandlers,
    aggregation.createPort("superbet"),
  ),
];

// Stop providers first so their outboxes close before the aggregator exits.
async function stop(): Promise<void> {
  const results = await Promise.allSettled(
    providers.map((provider) => provider.stop()),
  );
  results.push(...(await Promise.allSettled([aggregation.stop()])));
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
} catch (error) {
  console.error("Application startup failed:", error);
  process.exitCode = 1;
  await stop().catch((failure: unknown) =>
    console.error("Application cleanup failed:", failure),
  );
}
