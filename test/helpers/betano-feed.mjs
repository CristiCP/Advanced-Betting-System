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

export function feedHarness(t, requestSnapshot = async () => feedSnapshot(), options = {}) {
  let feed, sequence = 0, generation = 0;
  const sockets = new Map(), memberships = new Map(), snapshots = [], errors = [], errorEvents = [], statuses = [], requests = [], commands = [];
  const controls = { automaticVersions: true, version: 10, events: { 11: structuredClone(feedEvent) } };
  const deliver = (id, type, extra = {}) => {
    const socket = sockets.get(id);
    if (!socket) return;
    feed.handle({ id, type, ...socket, sequence: ++sequence, ...extra });
  };
  const chunk = (id, record) => deliver(id, "stream-chunk", {
    chunk: new TextEncoder().encode(JSON.stringify(record) + "\x1e").buffer,
  });
  const version = (value = controls.version, flags = {}, eventId = 11, socketId = "betano:events:1") => chunk(socketId, {
    type: 1, target: "OnActiveLiveEventSplitVersion", arguments: [{
      eventId, version: value, includeEvent: true, includeMarkets: true, includeIncidents: false, ...flags,
    }],
  });
  const network = {
    async command(command) {
      commands.push(structuredClone(command));
      if (command.type === "request") {
        const overview = command.request.path.includes("/overview/");
        if (!overview) requests.push(command);
        const value = overview ? { events: structuredClone(controls.events) } : await requestSnapshot(requests.length, command);
        return { type: "request-response", commandId: 1, response: {
          statusCode: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(value)).buffer,
        } };
      }
      if (command.type === "start-socket") {
        sockets.set(command.id, { generation: ++generation, attempt: 1 });
        queueMicrotask(() => deliver(command.id, "stream-open", { response: { statusCode: 101, headers: {} } }));
      }
      if (command.type === "stop-socket") {
        sockets.delete(command.id);
        memberships.delete(command.id);
      }
      if (command.type === "send-socket") {
        const message = JSON.parse(command.data.slice(0, -1));
        if (message.protocol) queueMicrotask(() => chunk(command.id, {}));
        else if (message.type === 1) {
          if (message.target === "joinLiveEventGroup") {
            if (message.arguments[0].IncludeIncidents !== false)
              throw new Error("Expected the event-and-market split subscription.");
            const ids = command.id;
            memberships.set(ids, [...(memberships.get(ids) ?? []), ...message.arguments[0].eventIds]);
            if (controls.automaticVersions)
              for (const eventId of message.arguments[0].eventIds)
                queueMicrotask(() => version(controls.version, {}, eventId, command.id));
          }
          queueMicrotask(() => chunk(command.id, { type: 3, invocationId: message.invocationId }));
        }
      }
      return { type: "command-success", commandId: 1 };
    }, post() {},
  };
  feed = new BetanoFeed(network, { ...betanoConfig, retryDelayMs: 5, ...options }, {
    onEvents() {}, onSnapshot: (snapshot) => snapshots.push(structuredClone(snapshot)),
    onUpdate() {}, onRemove() {}, onStatus: (s) => statuses.push(s), onError: (error, eventId) => {
      errors.push(error);
      errorEvents.push({ error, eventId });
    },
  });
  t.after(() => feed.stop());
  return {
    feed, controls, snapshots, errors, errorEvents, statuses, requests, commands, sockets, network, chunk, version,
    socketFor(eventId) { return [...memberships].find(([, ids]) => ids.includes(eventId))?.[0]; },
    disconnect(id = "betano:events:1") {
      deliver(id, "stream-end", { cancelled: false });
      deliver(id, "stream-error", { error: "WebSocket closed (1005)." });
    },
    reopen(id = "betano:events:1") {
      sockets.get(id).attempt++;
      deliver(id, "stream-open", { response: { statusCode: 101, headers: {} } });
    },
  };
}
