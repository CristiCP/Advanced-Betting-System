import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { quoteView } from "./quotes.js";
import type {
  UiFrame,
  UiOptions,
  UiOpportunity,
  UiProvider,
  UiSelection,
  UiSummary,
} from "../model/ui.interfaces.js";

/** @file Serves a bounded, loopback-only dashboard without accessing vendor APIs. */

const options: UiOptions = JSON.parse(process.env.UI_SERVER_OPTIONS ?? "{}");
if (!process.send) throw new Error("UI server must run as a child process.");
const post = (message: unknown): void => {
  if (process.connected) process.send!(message);
};
const assets = new Map<string, { body: Buffer; type: string }>();
let client: ServerResponse | null = null;
let clientId = "";
let clientBlocked = false;
let selection: UiSelection | null = null;
let summary: UiSummary | null = null;
let generation = 0;
let sequence = 0;
let dropped = 0;
const quotes: Partial<Record<UiProvider, ReturnType<typeof quoteView>>> = {};
let history: UiOpportunity[] = [];

function write(value: unknown): void {
  if (client === null) return;
  if (clientBlocked) {
    client.destroy();
    return;
  }
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > options.maxFrameBytes) {
    client.destroy();
    return;
  }
  // A slow browser reconnects to a fresh snapshot rather than accumulating queued writes.
  clientBlocked = !client.write(`data: ${json}\n\n`);
}

function selectionValue(value: unknown): UiSelection | null | false {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (item.sport !== "football" && item.sport !== "tennis") return false;
  const result: UiSelection = { sport: item.sport };
  for (const provider of ["superbet", "betano"] as const) {
    const id = item[provider];
    if (id !== undefined) {
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
        return false;
      result[provider] = id;
    }
  }
  if (result.superbet === undefined && result.betano === undefined)
    return false;
  // The browser can observe only identities already present in the published discovery list.
  for (const provider of ["superbet", "betano"] as const) {
    if (
      result[provider] !== undefined &&
      !summary?.events[provider].some(
        (event) =>
          event.id === result[provider] && event.sport === result.sport,
      )
    )
      return false;
  }
  return result;
}

const server = createServer(async (request, response) => {
  try {
    const authority = `127.0.0.1:${(server.address() as { port: number }).port}`;
    if (request.headers.host !== authority) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
    const url = new URL(request.url ?? "/", `http://${authority}`);
    if (request.method === "GET" && url.pathname === "/api/stream") {
      client?.end("event: superseded\ndata: {}\n\n");
      client = response;
      clientBlocked = false;
      clientId = randomUUID();
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
      });
      response.write("retry: 1500\n\n");
      response.on("drain", () => {
        if (client === response) clientBlocked = false;
      });
      write({
        type: "snapshot",
        clientId,
        summary,
        selection,
        quotes,
        history,
        dropped,
        sequence,
      });
      post({ type: "viewers", connected: true });
      response.on("close", () => {
        if (client !== response) return;
        client = null;
        clientId = "";
        selection = null;
        delete quotes.superbet;
        delete quotes.betano;
        post({ type: "viewers", connected: false });
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/watch") {
      if (
        request.headers.origin !== `http://${authority}` ||
        request.headers["x-ui-client"] !== clientId ||
        client === null
      ) {
        response.writeHead(403).end();
        return;
      }
      let body = "";
      for await (const chunk of request) {
        body += String(chunk);
        if (body.length > 1_024) {
          response.writeHead(413).end();
          return;
        }
      }
      const value = selectionValue(JSON.parse(body));
      if (value === false) {
        response.writeHead(400).end();
        return;
      }
      selection = value;
      delete quotes.superbet;
      delete quotes.betano;
      post({ type: "watch", selection });
      response.writeHead(204).end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    const asset = assets.get(url.pathname);
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": asset.type }).end(asset.body);
  } catch {
    if (!response.headersSent) response.writeHead(400);
    response.end();
  }
});
server.requestTimeout = 5_000;
server.headersTimeout = 5_000;
server.maxConnections = 12;

process.on("message", (frame: UiFrame) => {
  if (frame.type !== "frame") return;
  try {
    if (frame.sequence <= sequence) return;
    sequence = frame.sequence;
    dropped = frame.dropped;
    if (frame.summary) summary = frame.summary;
    const resetQuotes = generation !== frame.generation;
    if (resetQuotes) {
      generation = frame.generation;
      delete quotes.superbet;
      delete quotes.betano;
    }
    // Ignore in-flight frames from a selection replaced by the browser before the parent saw it.
    const sameSelection =
      JSON.stringify(frame.selection) === JSON.stringify(selection);
    const changedQuotes: typeof quotes = {};
    if (sameSelection) {
      for (const quote of frame.quotes ?? []) {
        if (
          quote.generation === generation &&
          selection?.[quote.provider] === quote.eventId
        )
          changedQuotes[quote.provider] = quotes[quote.provider] =
            quoteView(quote);
      }
    }
    history.push(...frame.opportunities);
    history = history.slice(-options.historyLimit);
    write({
      type: "update",
      sequence,
      dropped,
      ...(frame.summary ? { summary } : {}),
      selection,
      ...(resetQuotes || Object.keys(changedQuotes).length
        ? { resetQuotes, quotes: changedQuotes }
        : {}),
      opportunities: frame.opportunities,
    });
  } finally {
    post({ type: "ack", sequence: frame.sequence });
  }
});

const heartbeat = setInterval(() => {
  if (client !== null && !clientBlocked)
    clientBlocked = !client.write(": heartbeat\n\n");
}, 15_000);
heartbeat.unref();
process.once("disconnect", () => {
  clearInterval(heartbeat);
  client?.destroy();
  server.close();
  server.closeAllConnections();
});

try {
  for (const [path, filename, type] of [
    ["/", "index.html", "text/html; charset=utf-8"],
    ["/app.js", "app.js", "text/javascript; charset=utf-8"],
    ["/paired-quotes.js", "paired-quotes.js", "text/javascript; charset=utf-8"],
    ["/style.css", "style.css", "text/css; charset=utf-8"],
  ] as const) {
    const base = new URL(`../browser/${filename}`, import.meta.url);
    assets.set(path, { body: await readFile(base), type });
  }
  server.once("error", (error) => {
    post({ type: "error", error: String(error) });
    process.disconnect?.();
  });
  server.listen(options.port, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port;
    post({ type: "ready", url: `http://127.0.0.1:${port}` });
  });
} catch (error) {
  post({ type: "error", error: String(error) });
  process.disconnect?.();
}
