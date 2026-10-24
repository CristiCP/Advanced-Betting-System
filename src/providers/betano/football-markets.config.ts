import type { BetanoFootballMarketDefinition } from "./model/football-markets.interfaces.js";

/**
 * @file Lists verified two-outcome football markets without guessing unknown vendor types.
 */

export const betanoFootballMarkets = [
  {
    typeId: 13,
    type: "HCTG",
    nameTemplate: "Total goluri Peste/Sub",
    kind: "total",
    statistic: "goals",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 39,
      },
      {
        role: "under",
        typeId: 40,
      },
    ],
  },
  {
    typeId: 14,
    type: "OUH1",
    nameTemplate: "Goluri prima repriză Peste/Sub",
    kind: "total",
    statistic: "goals",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 41,
      },
      {
        role: "under",
        typeId: 42,
      },
    ],
  },
  {
    typeId: 15,
    type: "BTSC",
    nameTemplate: "Ambele echipe înscriu",
    kind: "yes-no",
    statistic: "goals",
    period: "match",
    subject: "both",
    outcomes: [
      {
        role: "yes",
        typeId: 43,
        label: "Da (GG)",
      },
      {
        role: "no",
        typeId: 44,
        label: "Nu (NG)",
      },
    ],
    condition: "both-teams-score",
  },
  {
    typeId: 34,
    type: "CNOU",
    nameTemplate: "Cornere Peste/Sub",
    kind: "total",
    statistic: "corners",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 153,
      },
      {
        role: "under",
        typeId: 154,
      },
    ],
  },
  {
    typeId: 37,
    type: "COU1",
    nameTemplate: "Cornere prima repriză Sub/Peste",
    kind: "total",
    statistic: "corners",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 163,
      },
      {
        role: "under",
        typeId: 164,
      },
    ],
  },
  {
    typeId: 38,
    type: "COU2",
    nameTemplate: "Cornere a doua repriză Sub/Peste",
    kind: "total",
    statistic: "corners",
    period: "second-half",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 39,
    type: "XOF2",
    nameTemplate: "{HOME} Cornere Peste/Sub",
    kind: "total",
    statistic: "corners",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "over",
        typeId: 167,
      },
      {
        role: "under",
        typeId: 168,
      },
    ],
  },
  {
    typeId: 40,
    type: "YOF2",
    nameTemplate: "{AWAY} Cornere Peste/Sub",
    kind: "total",
    statistic: "corners",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "over",
        typeId: 169,
      },
      {
        role: "under",
        typeId: 170,
      },
    ],
  },
  {
    typeId: 41,
    type: "FXH2",
    nameTemplate: "Prima Repriză {HOME} Cornere Peste/Sub",
    kind: "total",
    statistic: "corners",
    period: "first-half",
    subject: "home",
    outcomes: [
      {
        role: "over",
        typeId: 171,
      },
      {
        role: "under",
        typeId: 172,
      },
    ],
  },
  {
    typeId: 42,
    type: "FYH2",
    nameTemplate: "Prima Repriză {AWAY} Cornere Peste/Sub",
    kind: "total",
    statistic: "corners",
    period: "first-half",
    subject: "away",
    outcomes: [
      {
        role: "over",
        typeId: 173,
      },
      {
        role: "under",
        typeId: 174,
      },
    ],
  },
  {
    typeId: 43,
    type: "FCH2",
    nameTemplate: "Handicap cornere (2-Way)",
    kind: "handicap",
    statistic: "corners",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "home",
      },
      {
        role: "away",
      },
    ],
  },
  {
    typeId: 48,
    type: "OTCO",
    nameTemplate: "Interval cornere Peste/Sub ({FROM} - {TO})",
    kind: "total",
    statistic: "corners",
    period: "interval",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 186,
      },
      {
        role: "under",
        typeId: 187,
      },
    ],
    intervalMinutes: 10,
  },
  {
    typeId: 49,
    type: "RCOU",
    nameTemplate: "Total cartonașe roșii",
    kind: "total",
    statistic: "red-cards",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 188,
      },
      {
        role: "under",
        typeId: 189,
      },
    ],
  },
  {
    typeId: 51,
    type: "HRED",
    nameTemplate: "{HOME} Cartonaș roșu",
    kind: "yes-no",
    statistic: "red-cards",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "yes",
        typeId: 192,
        label: "Da",
      },
      {
        role: "no",
        typeId: 193,
        label: "Nu",
      },
    ],
    condition: "red-card",
  },
  {
    typeId: 52,
    type: "ARED",
    nameTemplate: "{AWAY} Cartonaș roșu",
    kind: "yes-no",
    statistic: "red-cards",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "yes",
        typeId: 194,
        label: "Da",
      },
      {
        role: "no",
        typeId: 195,
        label: "Nu",
      },
    ],
    condition: "red-card",
  },
  {
    typeId: 53,
    type: "1RED",
    nameTemplate: "Cartonaș roșu Prima Repriză",
    kind: "yes-no",
    statistic: "red-cards",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "yes",
        typeId: 196,
        label: "Da",
      },
      {
        role: "no",
        typeId: 197,
        label: "Nu",
      },
    ],
    condition: "red-card",
  },
  {
    typeId: 56,
    type: "PNAW",
    nameTemplate: "Penalty acordat",
    kind: "yes-no",
    statistic: "penalties",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "yes",
        typeId: 202,
        label: "Da",
      },
      {
        role: "no",
        typeId: 203,
        label: "Nu",
      },
    ],
    condition: "penalty-awarded",
  },
  {
    typeId: 58,
    type: "X130",
    nameTemplate: "Penalty acordat Prima Repriză",
    kind: "yes-no",
    statistic: "penalties",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "yes",
        typeId: 206,
        label: "Da",
      },
      {
        role: "no",
        typeId: 207,
        label: "Nu",
      },
    ],
    condition: "penalty-awarded",
  },
  {
    typeId: 65,
    type: "TCOU",
    nameTemplate: "Total cartonașe Peste/Sub",
    kind: "total",
    statistic: "cards",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 1886,
      },
      {
        role: "under",
        typeId: 1887,
      },
    ],
  },
  {
    typeId: 66,
    type: "1COU",
    nameTemplate: "Total cartonașe (Peste/Sub) - Prima repriză",
    kind: "total",
    statistic: "cards",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 223,
      },
      {
        role: "under",
        typeId: 224,
      },
    ],
  },
  {
    typeId: 67,
    type: "AHCA",
    nameTemplate: "Handicap - Cartonașe",
    kind: "handicap",
    statistic: "cards",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "home",
        typeId: 225,
      },
      {
        role: "away",
        typeId: 226,
      },
    ],
  },
  {
    typeId: 68,
    type: "HCOU",
    nameTemplate: "{HOME} Total cartonașe (Peste/Sub)",
    kind: "total",
    statistic: "cards",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "over",
        typeId: 227,
      },
      {
        role: "under",
        typeId: 228,
      },
    ],
  },
  {
    typeId: 69,
    type: "ACOU",
    nameTemplate: "{AWAY} Total cartonașe (Peste/Sub)",
    kind: "total",
    statistic: "cards",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "over",
        typeId: 229,
      },
      {
        role: "under",
        typeId: 230,
      },
    ],
  },
  {
    typeId: 72,
    type: "OWNG",
    nameTemplate: "Autogol",
    kind: "yes-no",
    statistic: "own-goals",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "yes",
        label: "Da",
      },
      {
        role: "no",
        label: "Nu",
      },
    ],
    condition: "own-goal",
  },
  {
    typeId: 84,
    type: "OUHG",
    nameTemplate: "{HOME} - Total goluri Peste/Sub",
    kind: "total",
    statistic: "goals",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "over",
        typeId: 263,
      },
      {
        role: "under",
        typeId: 264,
      },
    ],
  },
  {
    typeId: 85,
    type: "OUAG",
    nameTemplate: "{AWAY} - Total goluri Peste/Sub",
    kind: "total",
    statistic: "goals",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "over",
        typeId: 265,
      },
      {
        role: "under",
        typeId: 266,
      },
    ],
  },
  {
    typeId: 114,
    type: "BTS1",
    nameTemplate: "Ambele echipe înscriu în prima repriză",
    kind: "yes-no",
    statistic: "goals",
    period: "first-half",
    subject: "both",
    outcomes: [
      {
        role: "yes",
        typeId: 347,
        label: "Da",
      },
      {
        role: "no",
        typeId: 348,
        label: "Nu",
      },
    ],
    condition: "both-teams-score",
  },
  {
    typeId: 115,
    type: "OU1H",
    nameTemplate: "Goluri prima repriză Peste/Sub {HOME}",
    kind: "total",
    statistic: "goals",
    period: "first-half",
    subject: "home",
    outcomes: [
      {
        role: "over",
        typeId: 349,
      },
      {
        role: "under",
        typeId: 350,
      },
    ],
  },
  {
    typeId: 116,
    type: "OU1A",
    nameTemplate: "Goluri prima repriză Peste/Sub {AWAY}",
    kind: "total",
    statistic: "goals",
    period: "first-half",
    subject: "away",
    outcomes: [
      {
        role: "over",
        typeId: 351,
      },
      {
        role: "under",
        typeId: 352,
      },
    ],
  },
  {
    typeId: 130,
    type: "OTGO",
    nameTemplate: "Interval goluri Peste/Sub ({FROM} - {TO})",
    kind: "total",
    statistic: "goals",
    period: "interval",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 395,
      },
      {
        role: "under",
        typeId: 396,
      },
    ],
    intervalMinutes: 15,
  },
  {
    typeId: 131,
    type: "OUH2",
    nameTemplate: "Goluri a doua repriză Peste/Sub",
    kind: "total",
    statistic: "goals",
    period: "second-half",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 397,
      },
      {
        role: "under",
        typeId: 398,
      },
    ],
  },
  {
    typeId: 137,
    type: "BTS2",
    nameTemplate: "Ambele echipe înscriu în a doua repriză",
    kind: "yes-no",
    statistic: "goals",
    period: "second-half",
    subject: "both",
    outcomes: [
      {
        role: "yes",
        typeId: 411,
        label: "Da",
      },
      {
        role: "no",
        typeId: 412,
        label: "Nu",
      },
    ],
    condition: "both-teams-score",
  },
  {
    typeId: 141,
    type: "GSBH",
    nameTemplate: "Gol marcat în ambele reprize",
    kind: "yes-no",
    statistic: "goals",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "yes",
        typeId: 420,
        label: "Da",
      },
      {
        role: "no",
        typeId: 421,
        label: "Nu",
      },
    ],
    condition: "goal-in-both-halves",
  },
  {
    typeId: 142,
    type: "O1BH",
    nameTemplate: "Peste 1,5 Goluri Marcate în Fiecare Repriză",
    kind: "yes-no",
    statistic: "goals",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "yes",
        typeId: 422,
        label: "Da",
      },
      {
        role: "no",
        typeId: 423,
        label: "Nu",
      },
    ],
    condition: "over-1.5-in-each-half",
  },
  {
    typeId: 143,
    type: "U1BH",
    nameTemplate: "Sub 1.5 goluri marcate în fiecare repriză",
    kind: "yes-no",
    statistic: "goals",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "yes",
        typeId: 424,
        label: "Da",
      },
      {
        role: "no",
        typeId: 425,
        label: "Nu",
      },
    ],
    condition: "under-1.5-in-each-half",
  },
  {
    typeId: 185,
    type: "AHRF",
    nameTemplate:
      "Handicap Asiatic (Scorul actual {SCORE_HOME} - {SCORE_AWAY})",
    kind: "asian-handicap",
    statistic: "goals",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "home",
        typeId: 6766,
      },
      {
        role: "away",
        typeId: 6767,
      },
    ],
  },
  {
    typeId: 186,
    type: "AHRH",
    nameTemplate:
      "Handicap Asiatic - Prima Repriză  (Scorul actual {SCORE_HOME} - {SCORE_AWAY})",
    kind: "asian-handicap",
    statistic: "goals",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "home",
        typeId: 1517,
      },
      {
        role: "away",
        typeId: 1518,
      },
    ],
  },
  {
    typeId: 189,
    type: "ASOU",
    nameTemplate: "Asiatic (Peste/Sub) Total goluri",
    kind: "asian-total",
    statistic: "goals",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 1525,
      },
      {
        role: "under",
        typeId: 1526,
      },
    ],
  },
  {
    typeId: 196,
    type: "AWFB",
    nameTemplate: "{AWAY} Câștigă după ce a fost condusă",
    kind: "yes-no",
    statistic: "goals",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "yes",
        label: "Da",
      },
      {
        role: "no",
        label: "Nu",
      },
    ],
    condition: "win-after-trailing",
  },
  {
    typeId: 270,
    type: "HWFB",
    nameTemplate: "{HOME} Câștigă după ce a fost condusă",
    kind: "yes-no",
    statistic: "goals",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "yes",
        label: "Da",
      },
      {
        role: "no",
        label: "Nu",
      },
    ],
    condition: "win-after-trailing",
  },
  {
    typeId: 275,
    type: "INGS",
    nameTemplate: "Gol marcat în prelungiri, Repriza a doua",
    kind: "yes-no",
    statistic: "goals",
    period: "second-half",
    subject: "total",
    outcomes: [
      {
        role: "yes",
        typeId: 781,
        label: "Da",
      },
      {
        role: "no",
        typeId: 780,
        label: "Nu",
      },
    ],
    condition: "goal-in-stoppage-time",
  },
  {
    typeId: 293,
    type: "OTCA",
    nameTemplate: "Interval cartonaș Peste/Sub ({FROM} - {TO})",
    kind: "total",
    statistic: "cards",
    period: "interval",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
    intervalMinutes: 10,
  },
  {
    typeId: 338,
    type: "XO22",
    nameTemplate: "A doua repriză {HOME} Cornere Peste/Sub",
    kind: "total",
    statistic: "corners",
    period: "second-half",
    subject: "home",
    outcomes: [
      {
        role: "over",
        typeId: 1152,
      },
      {
        role: "under",
        typeId: 1153,
      },
    ],
  },
  {
    typeId: 339,
    type: "YO22",
    nameTemplate: "A doua repriză {AWAY} Cornere Peste/Sub",
    kind: "total",
    statistic: "corners",
    period: "second-half",
    subject: "away",
    outcomes: [
      {
        role: "over",
        typeId: 1322,
      },
      {
        role: "under",
        typeId: 1323,
      },
    ],
  },
  {
    typeId: 343,
    type: "X002",
    nameTemplate: "Șuturi pe poartă",
    kind: "total",
    statistic: "shots-on-target",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 351,
    type: "X013",
    nameTemplate: "Total ofsaiduri",
    kind: "total",
    statistic: "offsides",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 364,
    type: "ASBH",
    nameTemplate: "{AWAY} Marchează în ambele reprize",
    kind: "yes-no",
    statistic: "goals",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "yes",
        typeId: 1405,
        label: "Da",
      },
      {
        role: "no",
        typeId: 1406,
        label: "Nu",
      },
    ],
    condition: "score-in-both-halves",
  },
  {
    typeId: 384,
    type: "HSBH",
    nameTemplate: "{HOME} Marchează în ambele reprize",
    kind: "yes-no",
    statistic: "goals",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "yes",
        typeId: 711,
        label: "Da",
      },
      {
        role: "no",
        typeId: 710,
        label: "Nu",
      },
    ],
    condition: "score-in-both-halves",
  },
  {
    typeId: 395,
    type: "AOH1",
    nameTemplate: "Asiatic (Peste/Sub) - Total goluri marcate în Prima repriză",
    kind: "asian-total",
    statistic: "goals",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 1493,
      },
      {
        role: "under",
        typeId: 1494,
      },
    ],
  },
  {
    typeId: 431,
    type: "AWBH",
    nameTemplate: "{AWAY} câştigă ambele reprize",
    kind: "yes-no",
    statistic: "goals",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "yes",
        typeId: 1407,
        label: "Da",
      },
      {
        role: "no",
        typeId: 1408,
        label: "Nu",
      },
    ],
    condition: "win-both-halves",
  },
  {
    typeId: 434,
    type: "HWBH",
    nameTemplate: "{HOME} câştigă ambele reprize",
    kind: "yes-no",
    statistic: "goals",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "yes",
        typeId: 728,
        label: "Da",
      },
      {
        role: "no",
        typeId: 729,
        label: "Nu",
      },
    ],
    condition: "win-both-halves",
  },
  {
    typeId: 436,
    type: "X131",
    nameTemplate: "{HOME} Total ofsaiduri",
    kind: "total",
    statistic: "offsides",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 437,
    type: "X132",
    nameTemplate: "{AWAY} Total ofsaiduri",
    kind: "total",
    statistic: "offsides",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 449,
    type: "X134",
    nameTemplate: "{AWAY} Șuturi pe poartă",
    kind: "total",
    statistic: "shots-on-target",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 457,
    type: "X088",
    nameTemplate: "Loveşte bara",
    kind: "total",
    statistic: "woodwork",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 460,
    type: "X128",
    nameTemplate: "Total aruncări de la margine",
    kind: "total",
    statistic: "throw-ins",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 493,
    type: "X136",
    nameTemplate: "{AWAY} Total faulturi comise",
    kind: "total",
    statistic: "fouls",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 535,
    type: "X133",
    nameTemplate: "{HOME} Șuturi pe poartă",
    kind: "total",
    statistic: "shots-on-target",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 536,
    type: "X135",
    nameTemplate: "{HOME} Total faulturi comise",
    kind: "total",
    statistic: "fouls",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 613,
    type: "INGF",
    nameTemplate: "Gol marcat în minutele de prelungire ale primei reprize",
    kind: "yes-no",
    statistic: "goals",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "yes",
        typeId: 778,
        label: "Da",
      },
      {
        role: "no",
        typeId: 779,
        label: "Nu",
      },
    ],
    condition: "goal-in-stoppage-time",
  },
  {
    typeId: 643,
    type: "X328",
    nameTemplate: "Total lovituri de poartă",
    kind: "total",
    statistic: "goal-kicks",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 4049,
    type: "4049",
    nameTemplate: "A doua repriză - Total goluri Peste/Sub {HOME}",
    kind: "total",
    statistic: "goals",
    period: "second-half",
    subject: "home",
    outcomes: [
      {
        role: "over",
        typeId: 10922,
      },
      {
        role: "under",
        typeId: 10923,
      },
    ],
  },
  {
    typeId: 4050,
    type: "4050",
    nameTemplate: "A doua repriză - Total goluri Peste/Sub {AWAY}",
    kind: "total",
    statistic: "goals",
    period: "second-half",
    subject: "away",
    outcomes: [
      {
        role: "over",
        typeId: 10924,
      },
      {
        role: "under",
        typeId: 10925,
      },
    ],
  },
  {
    typeId: 4104,
    type: "4104",
    nameTemplate: "Prima Repriză Total lovituri de poartă",
    kind: "total",
    statistic: "goal-kicks",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 4106,
    type: "4106",
    nameTemplate: "Prima Repriză Total aruncări de la margine",
    kind: "total",
    statistic: "throw-ins",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 4107,
    type: "4107",
    nameTemplate: "Prima Repriză Ofsaiduri peste/sub",
    kind: "total",
    statistic: "offsides",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 4108,
    type: "4108",
    nameTemplate: "Prima Repriză Șuturi pe poartă",
    kind: "total",
    statistic: "shots-on-target",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 4111,
    type: "4111",
    nameTemplate: "Lovituri de poartă Handicap 2-Way",
    kind: "handicap",
    statistic: "goal-kicks",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "home",
      },
      {
        role: "away",
      },
    ],
  },
  {
    typeId: 4113,
    type: "4113",
    nameTemplate: "Aruncări de la margine Handicap 2-Way",
    kind: "handicap",
    statistic: "throw-ins",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "home",
      },
      {
        role: "away",
      },
    ],
  },
  {
    typeId: 4114,
    type: "4114",
    nameTemplate: "Ofsaiduri Handicap 2-Way",
    kind: "handicap",
    statistic: "offsides",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "home",
      },
      {
        role: "away",
      },
    ],
  },
  {
    typeId: 4115,
    type: "4115",
    nameTemplate: "Șuturi pe poartă Handicap 2-Way",
    kind: "handicap",
    statistic: "shots-on-target",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "home",
      },
      {
        role: "away",
      },
    ],
  },
  {
    typeId: 4151,
    type: "4151",
    nameTemplate: "Ambele echipe să primească un cartonaș",
    kind: "yes-no",
    statistic: "cards",
    period: "match",
    subject: "both",
    outcomes: [
      {
        role: "yes",
        typeId: 11378,
        label: "Da",
      },
      {
        role: "no",
        typeId: 11379,
        label: "Nu",
      },
    ],
    condition: "each-team-at-least-one",
  },
  {
    typeId: 4152,
    type: "4152",
    nameTemplate: "Ambele echipe să primească 2+ cartonașe",
    kind: "yes-no",
    statistic: "cards",
    period: "match",
    subject: "both",
    outcomes: [
      {
        role: "yes",
        typeId: 11380,
        label: "Da",
      },
      {
        role: "no",
        typeId: 11381,
        label: "Nu",
      },
    ],
    condition: "each-team-at-least-two",
  },
  {
    typeId: 4155,
    type: "4155",
    nameTemplate: "{HOME} Total cartonașe în prima repriză",
    kind: "total",
    statistic: "cards",
    period: "first-half",
    subject: "home",
    outcomes: [
      {
        role: "over",
        typeId: 11447,
      },
      {
        role: "under",
        typeId: 11448,
      },
    ],
  },
  {
    typeId: 4156,
    type: "4156",
    nameTemplate: "{AWAY} Total cartonașe în prima repriză",
    kind: "total",
    statistic: "cards",
    period: "first-half",
    subject: "away",
    outcomes: [
      {
        role: "over",
        typeId: 11449,
      },
      {
        role: "under",
        typeId: 11450,
      },
    ],
  },
  {
    typeId: 4157,
    type: "4157",
    nameTemplate: "{HOME} Total Cartonașe Repriza a Doua Peste/Sub",
    kind: "total",
    statistic: "cards",
    period: "second-half",
    subject: "home",
    outcomes: [
      {
        role: "over",
        typeId: 11451,
      },
      {
        role: "under",
        typeId: 11452,
      },
    ],
  },
  {
    typeId: 4158,
    type: "4158",
    nameTemplate: "{AWAY} Total Cartonașe Repriza a Doua Peste/Sub",
    kind: "total",
    statistic: "cards",
    period: "second-half",
    subject: "away",
    outcomes: [
      {
        role: "over",
        typeId: 11453,
      },
      {
        role: "under",
        typeId: 11454,
      },
    ],
  },
  {
    typeId: 4159,
    type: "4159",
    nameTemplate: "Total șuturi",
    kind: "total",
    statistic: "shots",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 4160,
    type: "4160",
    nameTemplate: "{HOME} Total șuturi",
    kind: "total",
    statistic: "shots",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 4161,
    type: "4161",
    nameTemplate: "{AWAY} Total șuturi",
    kind: "total",
    statistic: "shots",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 4165,
    type: "4165",
    nameTemplate: "{HOME} Total lovituri de poartă",
    kind: "total",
    statistic: "goal-kicks",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 4166,
    type: "4166",
    nameTemplate: "{AWAY} Total lovituri de poartă",
    kind: "total",
    statistic: "goal-kicks",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 4167,
    type: "4167",
    nameTemplate: "{HOME} Total aruncări de la margine",
    kind: "total",
    statistic: "throw-ins",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 4168,
    type: "4168",
    nameTemplate: "{AWAY} Total aruncări de la margine",
    kind: "total",
    statistic: "throw-ins",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 4629,
    type: "4629",
    nameTemplate: "Total faulturi comise",
    kind: "total",
    statistic: "fouls",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 5014,
    type: "5014",
    nameTemplate: "Cartonaș acordat în ambele reprize",
    kind: "yes-no",
    statistic: "cards",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "yes",
        typeId: 13339,
        label: "Da",
      },
      {
        role: "no",
        typeId: 13340,
        label: "Nu",
      },
    ],
    condition: "card-in-both-halves",
  },
  {
    typeId: 5016,
    type: "5016",
    nameTemplate: "{HOME} Interval cornere Peste/Sub ({FROM} - {TO})",
    kind: "total",
    statistic: "corners",
    period: "interval",
    subject: "home",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
    intervalMinutes: 10,
  },
  {
    typeId: 5017,
    type: "5017",
    nameTemplate: "{AWAY} Interval cornere Peste/Sub ({FROM} - {TO})",
    kind: "total",
    statistic: "corners",
    period: "interval",
    subject: "away",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
    intervalMinutes: 10,
  },
  {
    typeId: 5025,
    type: "5025",
    nameTemplate: "{HOME} Penalty acordat",
    kind: "yes-no",
    statistic: "penalties",
    period: "match",
    subject: "home",
    outcomes: [
      {
        role: "yes",
        typeId: 13363,
        label: "Da",
      },
      {
        role: "no",
        typeId: 13364,
        label: "Nu",
      },
    ],
    condition: "penalty-awarded",
  },
  {
    typeId: 5026,
    type: "5026",
    nameTemplate: "{AWAY} Penalty acordat",
    kind: "yes-no",
    statistic: "penalties",
    period: "match",
    subject: "away",
    outcomes: [
      {
        role: "yes",
        typeId: 13365,
        label: "Da",
      },
      {
        role: "no",
        typeId: 13366,
        label: "Nu",
      },
    ],
    condition: "penalty-awarded",
  },
  {
    typeId: 1000617,
    type: "1000617",
    nameTemplate: "Asiatic (Peste/Sub) Total cornere",
    kind: "asian-total",
    statistic: "corners",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
  {
    typeId: 1000618,
    type: "1000618",
    nameTemplate: "Asiatic (Peste/Sub) Total cartonașe",
    kind: "asian-total",
    statistic: "cards",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 1001912,
      },
      {
        role: "under",
        typeId: 1001913,
      },
    ],
  },
  {
    typeId: 1000619,
    type: "1000619",
    nameTemplate: "Asiatic (Peste/Sub) - Total Cornere Prima Repriză",
    kind: "asian-total",
    statistic: "corners",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 1001914,
      },
      {
        role: "under",
        typeId: 1001915,
      },
    ],
  },
  {
    typeId: 1000620,
    type: "1000620",
    nameTemplate: "Asiatic (Peste/Sub) - Total Cartonașe Prima Repriză",
    kind: "asian-total",
    statistic: "cards",
    period: "first-half",
    subject: "total",
    outcomes: [
      {
        role: "over",
      },
      {
        role: "under",
      },
    ],
  },
] as const satisfies readonly BetanoFootballMarketDefinition[];
