import type { TaskHandlers } from "./model/controller.interfaces.js";

const ORANGE = "\u001b[38;5;208m";
const RESET = "\u001b[0m";

export function logBettingDecision(
  category: string,
  status: string,
  detail: string,
): void {
  console.log(
    `${ORANGE}[${category.toUpperCase()} ${status}] ${detail}${RESET}`,
  );
}

export const taskConsoleHandlers: TaskHandlers = {
  onState(task) {
    const duration =
      task.startedAt !== null && task.finishedAt !== null
        ? ` | durationMs=${task.finishedAt - task.startedAt}`
        : "";
    const error = task.error === undefined ? "" : ` | error=${task.error}`;
    const result =
      task.status === "completed" && task.result !== undefined
        ? ` | result=${JSON.stringify(task.result)}`
        : "";
    const provider = task.category.toUpperCase();
    const status = `${provider} ${task.status === "completed" ? "PASSED" : task.status.toUpperCase()}`;
    const message = `[${status}] ${task.id} | category=${task.category} | version=${task.version}${duration}${error}${result}`;

    console.log(
      `${ORANGE}${message}${RESET}`,
    );
  },
  onError(error) {
    console.error("Tasks:", error);
  },
};
