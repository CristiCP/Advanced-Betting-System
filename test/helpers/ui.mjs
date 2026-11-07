export function uiSnapshot(provider = "betano", id = 101, version = 1) {
  const common = {
    id,
    phase: "live",
    home: { id: "1", name: "Home" },
    away: { id: "2", name: "Away" },
    homeScore: "0",
    awayScore: "0",
  };
  return {
    provider,
    sourceVersion: version,
    projectedAt: version,
    synchronized: true,
    event:
      provider === "betano"
        ? { ...common, isSuspended: false }
        : { ...common, offerStatus: 1 },
    lines: [
      {
        key: "total:2.5",
        marketId: provider === "betano" ? 501 : 200734,
        ...(provider === "betano"
          ? {
              marketTypeId: 13,
              isSuspended: false,
              interval: null,
              scoreContext: null,
            }
          : {
              lineId: "1",
              offerStateId: 2,
              fromMinute: null,
              toMinute: null,
              firstMinutes: null,
            }),
        total: 2.5,
        handicap: null,
        selections: ["over", "under"].map((role, index) => ({
          id: String(index),
          role,
          price: index ? 1.9 : 2.1,
          ...(provider === "betano"
            ? { isSuspended: false }
            : { status: 1, display: true }),
        })),
      },
    ],
  };
}

export function uiReport(kind = "open", id = 1, sport = "football") {
  return {
    kind,
    id,
    sport,
    at: Date.now(),
    match: "Home - Away",
    score: "0-0",
    concept: "Total",
    line: 2.5,
    marginBps: 100,
    durationMs: 10,
    legs: [
      { provider: "superbet", label: "Over", price: 2.1 },
      { provider: "betano", label: "Under", price: 2.1 },
    ],
  };
}

export async function uiStream(url, signal) {
  const response = await fetch(`${url}/api/stream`, { signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(predicate = () => true) {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        let index;
        while ((index = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const line = chunk
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (line) {
            const data = JSON.parse(line.slice(6));
            if (predicate(data)) return data;
          }
        }
        let timeout;
        try {
          const result = await Promise.race([
            reader.read(),
            new Promise((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error("UI stream timed out.")),
                Math.max(1, deadline - Date.now()),
              );
            }),
          ]);
          if (result.done) throw new Error("UI stream closed.");
          buffer += decoder.decode(result.value, { stream: true });
        } finally {
          clearTimeout(timeout);
        }
      }
      throw new Error("No matching UI update.");
    },
  };
}
