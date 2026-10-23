import { BetanoController } from "./providers/betano/controller.js";
import { betanoConsoleHandlers } from "./providers/betano/logging.js";
import { SuperbetController } from "./providers/superbet/controller.js";
import { superbetConsoleHandlers } from "./providers/superbet/logging.js";

// Give each provider independent network and processing workers.
const providers = [
  new BetanoController({}, betanoConsoleHandlers),
  new SuperbetController({}, superbetConsoleHandlers),
];

// Attempt to stop every provider even when another shutdown fails.
async function stop(): Promise<void> {
  const results = await Promise.allSettled(
    providers.map((provider) => provider.stop()),
  );
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (errors.length)
    throw new AggregateError(errors, "Provider shutdown failed.");
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

// Start providers concurrently and release both if startup fails.
try {
  await Promise.all(providers.map((provider) => provider.start()));
} catch (error) {
  console.error("Application startup failed:", error);
  process.exitCode = 1;
  await stop().catch((failure: unknown) =>
    console.error("Application cleanup failed:", failure),
  );
}
