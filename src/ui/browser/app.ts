import type {
  UiOpportunity,
  UiProvider,
  UiBrowserUpdate,
  UiSelection,
  UiSummary,
} from "../model/ui.interfaces.js";
import { pairedQuoteRows } from "./paired-quotes.js";

/** @file Renders bounded pages and subscribes only while the dashboard is visible. */

const element = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const input = (id: string): string => element<HTMLInputElement>(id).value;
const text = (id: string, value: string): void => {
  const node = element(id);
  if (node.textContent !== value) node.textContent = value;
};
const sportName: Record<string, string> = {
  football: "Fotbal",
  tennis: "Tenis",
  basketball: "Baschet",
};
const pageSize = 60;
let source: EventSource | null = null;
let clientId = "";
let summary: UiSummary | null = null;
let selected: UiSelection | null = null;
let selectedName = "";
let quoteData: NonNullable<UiBrowserUpdate["quotes"]> = {};
let history: UiOpportunity[] = [];
let tab = "matches";
let page = 0;
let quotePage = 0;
let opportunityPage = 0;
let watchRevision = 0;
let watchSending = false;
let desiredWatch: UiSelection | null = null;
let watchPending = false;
let latestSelectionJson = "null";
const rowsByKey = new Map<string, HTMLTableRowElement>();
let matchActions: (UiSelection | null)[] = [];

// Serialize selection commands, so rapid clicks cannot restore an older subscription.
async function sendWatch(selection: UiSelection | null): Promise<void> {
  desiredWatch = selection;
  watchPending = true;
  if (watchSending || !clientId || document.hidden) return;
  watchSending = true;
  try {
    while (watchPending && clientId && !document.hidden) {
      watchPending = false;
      const revision = ++watchRevision;
      const response = await fetch("/api/watch", {
        method: "POST",
        headers: { "X-UI-Client": clientId },
        body: JSON.stringify(desiredWatch),
      });
      if (!response.ok && revision === watchRevision) {
        text(
          "quote-status",
          "Abonamentul nu a fost acceptat. Verifică dacă meciul mai există în listă.",
        );
      }
    }
  } catch {
    text("quote-status", "Conexiune întreruptă. Aștept reconectarea.");
  } finally {
    watchSending = false;
  }
}

function switchTab(next: string): void {
  tab = next;
  for (const name of ["matches", "quotes", "opportunities"])
    element(name).hidden = name !== next;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-tab]",
  ))
    button.setAttribute("aria-selected", String(button.dataset.tab === next));
  quoteData = {};
  void sendWatch(next === "quotes" ? selected : null);
  render();
}

function overview(): void {
  if (!summary) return;
  for (const provider of ["superbet", "betano"] as const) {
    const count = summary.counts[provider];
    text(
      `${provider}-total`,
      String(count.football + count.basketball + count.tennis),
    );
    text(
      `${provider}-sports`,
      `Fotbal ${count.football} · Tenis ${count.tennis} · Baschet ${count.basketball}`,
    );
  }
  const matched = { football: 0, tennis: 0 };
  for (const pair of summary.matches) matched[pair.sport ?? "football"]++;
  text("matched-total", String(matched.football + matched.tennis));
  text(
    "matched-sports",
    `Fotbal ${matched.football} · Tenis ${matched.tennis}`,
  );
  const football =
    summary.stats?.sports?.football?.activeMatches ??
    summary.stats?.activeMatches ??
    0;
  const tennis = summary.stats?.sports?.tennis?.activeMatches ?? 0;
  text("active-total", summary.stats ? String(football + tennis) : "—");
  text("active-sports", `Fotbal ${football} · Tenis ${tennis}`);
  text(
    "updated",
    `Stare publicată la ${new Date(summary.at).toLocaleTimeString("ro-RO")}`,
  );
}

function pageControls(prefix: string, total: number, current: number): void {
  element<HTMLButtonElement>(`${prefix}previous`).disabled = current === 0;
  element<HTMLButtonElement>(`${prefix}next`).disabled =
    (current + 1) * pageSize >= total;
  text(
    `${prefix}page`,
    `${current + 1} / ${Math.max(1, Math.ceil(total / pageSize))}`,
  );
}

function renderMatches(): void {
  if (!summary) return;
  const search = input("search").trim().toLocaleLowerCase();
  const sport = input("sport");
  const mode = input("mode");
  const pairs = new Map(
    summary.matches.flatMap(
      (pair) =>
        [
          [`superbet:${pair.superbetEventId}`, pair],
          [`betano:${pair.betanoEventId}`, pair],
        ] as const,
    ),
  );
  const matches =
    mode === "matched"
      ? summary.matches.map((pair) => ({
          name: pair.superbetMatch,
          sport: pair.sport ?? "football",
          site: String(pair.superbetEventId),
          other: String(pair.betanoEventId),
          selection: {
            sport: pair.sport ?? "football",
            superbet: pair.superbetEventId,
            betano: pair.betanoEventId,
          } as UiSelection,
        }))
      : Object.values(summary.events)
          .flat()
          .filter((event) => mode === "all" || event.provider === mode)
          .map((event) => {
            const pair = pairs.get(`${event.provider}:${event.id}`);
            const selection: UiSelection | null =
              event.sport === "basketball"
                ? null
                : pair
                  ? {
                      sport: pair.sport ?? "football",
                      superbet: pair.superbetEventId,
                      betano: pair.betanoEventId,
                    }
                  : { sport: event.sport, [event.provider]: event.id };
            return {
              name: event.name,
              sport: event.sport,
              site: `${event.provider} / ${event.id}`,
              other: pair ? String(pair.betanoEventId) : "—",
              selection,
            };
          });
  const filtered = matches.filter(
    (item) =>
      (sport === "all" || item.sport === sport) &&
      `${item.name} ${item.site} ${item.other}`
        .toLocaleLowerCase()
        .includes(search),
  );
  page = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const fragment = document.createDocumentFragment();
  matchActions = [];
  for (const item of filtered.slice(page * pageSize, (page + 1) * pageSize)) {
    const row = document.createElement("tr");
    for (const value of [
      item.name,
      sportName[item.sport] ?? item.sport,
      item.site,
      item.other,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    const cell = document.createElement("td");
    const button = document.createElement("button");
    button.textContent = item.selection ? "Vezi cote ↗" : "Doar date brute";
    button.disabled = item.selection === null;
    button.dataset.action = String(matchActions.length);
    button.dataset.name = item.name;
    matchActions.push(item.selection);
    cell.append(button);
    row.append(cell);
    fragment.append(row);
  }
  element("match-rows").replaceChildren(fragment);
  text("match-count", `${filtered.length} rezultate`);
  text(
    "match-empty",
    filtered.length
      ? `Afișate ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} din ${filtered.length}`
      : "Niciun meci pentru filtrele selectate.",
  );
  pageControls("", filtered.length, page);
}

function renderQuotes(): void {
  text("quote-title", selectedName || "Selectează un meci");
  const sources = selected
    ? (["superbet", "betano"] as const).filter(
        (provider) => selected![provider] !== undefined,
      )
    : [];
  text(
    "quote-status",
    sources.length
      ? sources
          .map((provider) => {
            const data = quoteData[provider];
            return `${provider} #${selected![provider]}: ${
              !data
                ? "aștept starea curentă"
                : !data.synchronized
                  ? "nesincronizat sau meci retras"
                  : `${data.suspended ? "suspendat · " : ""}${data.score ?? ""} · v${data.sourceVersion ?? "?"} · observat ${new Date(data.at).toLocaleTimeString("ro-RO")}${data.truncated ? " · listă trunchiată" : ""}`
            }`;
          })
          .join(" | ")
      : "Deschide un meci din primul tab.",
  );
  const search = input("market-search").trim().toLocaleLowerCase();
  const rows = pairedQuoteRows(quoteData)
    .filter((row) =>
      `${row.market} ${row.line} ${row.superbet.marketId} ${row.betano.marketId}`
        .toLocaleLowerCase()
        .includes(search),
    )
    .sort(
      (a, b) =>
        a.market.localeCompare(b.market) || a.line.localeCompare(b.line),
    );
  quotePage = Math.min(
    quotePage,
    Math.max(0, Math.ceil(rows.length / pageSize) - 1),
  );
  const visible = rows.slice(quotePage * pageSize, (quotePage + 1) * pageSize);
  const wanted = new Set(visible.map((row) => row.key));
  for (const [key, row] of rowsByKey)
    if (!wanted.has(key)) {
      row.remove();
      rowsByKey.delete(key);
    }
  const body = element("quote-rows");
  visible.forEach((item, index) => {
    let row = rowsByKey.get(item.key);
    if (!row) {
      row = document.createElement("tr");
      for (let i = 0; i < 6; i++) row.append(document.createElement("td"));
      rowsByKey.set(item.key, row);
    }
    const selections = [...item.superbet.selections, ...item.betano.selections];
    const values = [
      item.market,
      item.line,
      ...selections.map(
        (selection) =>
          `${selection.label} @ ${selection.price?.toFixed(2) ?? "—"}${selection.available ? "" : " · indisponibil"}`,
      ),
    ];
    values.forEach((value, cellIndex) => {
      const cell = row!.children[cellIndex] as HTMLTableCellElement;
      if (cell.textContent !== value) cell.textContent = value;
      if (cellIndex >= 2)
        cell.className = selections[cellIndex - 2]?.available
          ? "available"
          : "unavailable";
    });
    if (body.children[index] !== row)
      body.insertBefore(row, body.children[index] ?? null);
  });
  text("quote-count", `${rows.length} linii asociate`);
  text(
    "quote-empty",
    rows.length
      ? "Aceeași linie pe ambele siteuri; cotele sunt aliniate după sensul selecției."
      : selected
        ? selected.superbet === undefined || selected.betano === undefined
          ? "Meciul nu are pereche selectată. Deschide un meci din lista de perechi confirmate."
          : "Aștept ambele surse sincronizate sau nu există linii comune pentru acest filtru."
        : "Niciun meci selectat.",
  );
  pageControls("quote-", rows.length, quotePage);
}

function renderOpportunities(): void {
  const search = input("opportunity-search").trim().toLocaleLowerCase();
  const sport = input("opportunity-sport");
  const filtered = history
    .filter(
      (report) =>
        (sport === "all" || report.sport === sport) &&
        `${report.match} ${report.concept}`
          .toLocaleLowerCase()
          .includes(search),
    )
    .slice()
    .reverse();
  opportunityPage = Math.min(
    opportunityPage,
    Math.max(0, Math.ceil(filtered.length / pageSize) - 1),
  );
  const fragment = document.createDocumentFragment();
  const labels = {
    open: "FOUND",
    update: "UPDATE",
    pause: "PAUSED",
    resume: "RESUMED",
    close: "CLOSED",
  };
  for (const report of filtered.slice(
    opportunityPage * pageSize,
    (opportunityPage + 1) * pageSize,
  )) {
    const row = document.createElement("article");
    row.className =
      report.kind === "close" &&
      report.reason === "margin" &&
      report.marginBps > 50
        ? "purple"
        : report.kind;
    row.textContent = `[${new Date(report.at).toISOString().slice(11, 23)}Z ${labels[report.kind]} #${report.id}] [${sportName[report.sport]}] ${report.match} (${report.score}) | ${report.concept} | linie=${report.line} | ${report.legs.map((leg) => `${leg.provider} ${leg.label} @ ${leg.price}`).join(" <> ")} | marja=${report.marginBps >= 0 ? "+" : ""}${(report.marginBps / 100).toFixed(2)}%${report.kind === "close" ? ` | durata=${(report.durationMs / 1000).toFixed(3)}s | motiv=${report.reason ?? "?"}${report.reasonDetail ? `: ${report.reasonDetail}` : ""}` : ""}`;
    fragment.append(row);
  }
  element("opportunity-rows").replaceChildren(fragment);
  text("history-count", `${history.length} evenimente`);
  element("opportunity-empty").hidden = filtered.length > 0;
  pageControls("opportunity-", filtered.length, opportunityPage);
}

function render(): void {
  overview();
  if (tab === "matches") renderMatches();
  else if (tab === "quotes") renderQuotes();
  else renderOpportunities();
}

function connect(): void {
  if (source || document.hidden) return;
  source = new EventSource("/api/stream");
  source.addEventListener("superseded", () => {
    source?.close();
    source = null;
    clientId = "";
    quoteData = {};
    element("connection").className = "badge muted";
    text("connection", "Observare mutată în altă fereastră");
    if (tab === "quotes") renderQuotes();
  });
  source.onmessage = (event: MessageEvent<string>) => {
    const update: UiBrowserUpdate = JSON.parse(event.data);
    if (update.clientId) {
      clientId = update.clientId;
      if (tab === "quotes" && selected) void sendWatch(selected);
    }
    if (update.summary) summary = update.summary;
    if (update.history) history = update.history;
    if (update.opportunities?.length)
      history = history.concat(update.opportunities).slice(-500);
    if (JSON.stringify(update.selection) === latestSelectionJson) {
      if (update.resetQuotes || update.type === "snapshot") quoteData = {};
      if (update.quotes) Object.assign(quoteData, update.quotes);
    }
    element("connection").className = "badge";
    text("connection", "● Conectat");
    text(
      "diagnostics",
      `${update.dropped ? `${update.dropped} evenimente omise din canalul UI · ` : ""}${summary?.truncated ? "listă trunchiată · " : ""}observare limitată / un meci deschis`,
    );
    if (update.summary) overview();
    if (tab === "matches" && update.summary) renderMatches();
    if (tab === "quotes" && (update.quotes || update.resetQuotes))
      renderQuotes();
    if (
      tab === "opportunities" &&
      (update.history || update.opportunities?.length)
    )
      renderOpportunities();
  };
  source.onerror = () => {
    clientId = "";
    quoteData = {};
    element("connection").className = "badge error";
    text("connection", "Reconectare…");
    if (tab === "quotes") renderQuotes();
  };
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tab]"))
  button.addEventListener("click", () => {
    latestSelectionJson = JSON.stringify(
      button.dataset.tab === "quotes" ? selected : null,
    );
    switchTab(button.dataset.tab!);
  });
element("match-rows").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (!button) return;
  selected = matchActions[Number(button.dataset.action)] ?? null;
  selectedName = button.dataset.name ?? "";
  latestSelectionJson = JSON.stringify(selected);
  quotePage = 0;
  switchTab("quotes");
});
element("close-match").addEventListener("click", () => {
  selected = null;
  selectedName = "";
  latestSelectionJson = "null";
  quoteData = {};
  void sendWatch(null);
  renderQuotes();
});
for (const id of [
  "search",
  "sport",
  "mode",
  "market-search",
  "opportunity-search",
  "opportunity-sport",
]) {
  let timer: ReturnType<typeof setTimeout>;
  element(id).addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      page = 0;
      quotePage = 0;
      opportunityPage = 0;
      render();
    }, 150);
  });
}
for (const [prefix, getter, setter] of [
  [
    "",
    () => page,
    (value: number) => {
      page = value;
    },
  ],
  [
    "quote-",
    () => quotePage,
    (value: number) => {
      quotePage = value;
    },
  ],
  [
    "opportunity-",
    () => opportunityPage,
    (value: number) => {
      opportunityPage = value;
    },
  ],
] as const) {
  element(`${prefix}previous`).addEventListener("click", () => {
    setter(Math.max(0, getter() - 1));
    render();
  });
  element(`${prefix}next`).addEventListener("click", () => {
    setter(getter() + 1);
    render();
  });
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    source?.close();
    source = null;
    clientId = "";
    quoteData = {};
    text("connection", "Observare în pauză");
  } else connect();
});
connect();
