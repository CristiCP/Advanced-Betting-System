import { BetanoFeed } from "../../dist/providers/betano/processing/feed.js";
import { betanoConfig } from "../../dist/providers/betano/config.js";

export const feedEvent = { id: 11, sportId: "FOOT", isLive: true, marketIdList: [100] };
export const feedSnapshot = (version = 10) => ({
  version: version + 3,
  versionsPerAudience: { 1: 0, 2: 3, 4: version, 7: 0, 8: 1 },
  event: structuredClone(feedEvent),
  markets: { 100: { id: 100, selectionIdList: [200] } },
  selections: { 200: { id: 200, price: 2 } },
});

export function feedHarness(t, requestSnapshot = async () => feedSnapshot()) {
  let feed, sequence = 0, generation = 0;
  const sockets = new Map(), snapshots = [], errors = [], statuses = [], requests = [];
  const controls = { automaticVersions: true, version: 10 };
  const deliver = (id, type, extra = {}) => {
    const socket = sockets.get(id);
    if (!socket) return;
    feed.handle({ id, type, ...socket, sequence: ++sequence, ...extra });
  };
  const chunk = (id, record) => deliver(id, "stream-chunk", {
    chunk: new TextEncoder().encode(JSON.stringify(record) + "\x1e").buffer,
  });
  const version = (value = controls.version, flags = {}) => chunk("betano:events:1", {
    type: 1, target: "OnActiveLiveEventSplitVersion", arguments: [{
      eventId: 11, version: value, includeEvent: true, includeMarkets: true, includeIncidents: false, ...flags,
    }],
  });
  const network = {
    async command(command) {
      if (command.type === "request") {
        const overview = command.request.path.includes("/overview/");
        if (!overview) requests.push(command);
        const value = overview ? { events: { 11: structuredClone(feedEvent) } } : await requestSnapshot(requests.length);
        return { type: "request-response", commandId: 1, response: {
          statusCode: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(value)).buffer,
        } };
      }
      if (command.type === "start-socket") {
        sockets.set(command.id, { generation: ++generation, attempt: 1 });
        queueMicrotask(() => deliver(command.id, "stream-open", { response: { statusCode: 101, headers: {} } }));
      }
      if (command.type === "stop-socket") sockets.delete(command.id);
      if (command.type === "send-socket") {
        const message = JSON.parse(command.data.slice(0, -1));
        if (message.protocol) queueMicrotask(() => chunk(command.id, {}));
        else if (message.type === 1) {
          if (message.target === "joinLiveEventGroup") {
            if (message.arguments[0].IncludeIncidents !== false)
              throw new Error("Expected the event-and-market split subscription.");
            if (controls.automaticVersions) queueMicrotask(() => version());
          }
          queueMicrotask(() => chunk(command.id, { type: 3, invocationId: message.invocationId }));
        }
      }
      return { type: "command-success", commandId: 1 };
    }, post() {},
  };
  feed = new BetanoFeed(network, { ...betanoConfig, retryDelayMs: 5 }, {
    onEvents() {}, onSnapshot: (snapshot) => snapshots.push(structuredClone(snapshot)),
    onUpdate() {}, onRemove() {}, onStatus: (s) => statuses.push(s), onError: (e) => errors.push(e),
  });
  t.after(() => feed.stop());
  return {
    feed, controls, snapshots, errors, statuses, requests, chunk, version,
    disconnect() {
      deliver("betano:events:1", "stream-end", { cancelled: false });
      deliver("betano:events:1", "stream-error", { error: "WebSocket closed (1005)." });
    },
    reopen() {
      sockets.get("betano:events:1").attempt++;
      deliver("betano:events:1", "stream-open", { response: { statusCode: 101, headers: {} } });
    },
  };
}
