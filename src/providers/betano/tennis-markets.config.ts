import type { BetanoTennisMarketDefinition } from "./model/tennis-markets.interfaces.js";

/**
 * @file Lists verified binary tennis markets; see docs/providers/betano/TENNIS.md.
 */

export const betanoTennisMarkets = [
  {
    typeId: 162,
    type: "TGHC",
    nameTemplate: "Total Game-uri Handicap",
    kind: "handicap",
    statistic: "games",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "player1",
        typeId: 459,
      },
      {
        role: "player2",
        typeId: 460,
      },
    ],
  },
  {
    typeId: 1359,
    type: "SF60",
    nameTemplate: "Oricare set se încheie 6:0 sau 0:6",
    kind: "yes-no",
    statistic: "bagel-sets",
    period: "match",
    subject: "total",
    condition: "bagel-set",
    outcomes: [
      {
        role: "yes",
        typeId: 3849,
      },
      {
        role: "no",
        typeId: 3850,
      },
    ],
  },
  {
    typeId: 1361,
    type: "BPWS",
    nameTemplate: "Ambii jucători să câștige un set",
    kind: "yes-no",
    statistic: "sets",
    period: "match",
    subject: "both",
    condition: "both-win-a-set",
    outcomes: [
      {
        role: "yes",
        typeId: 3888,
      },
      {
        role: "no",
        typeId: 3889,
      },
    ],
  },
  {
    typeId: 1381,
    type: "GHCS",
    nameTemplate: "Game-uri Handicap  (Set <SET>)",
    kind: "handicap",
    statistic: "games",
    period: "set",
    subject: "total",
    outcomes: [
      {
        role: "player1",
        typeId: 4028,
      },
      {
        role: "player2",
        typeId: 4029,
      },
    ],
  },
  {
    typeId: 1405,
    type: "MSSH",
    nameTemplate: "Handicap meci (Set)",
    kind: "handicap",
    statistic: "sets",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "player1",
        typeId: 4004,
      },
      {
        role: "player2",
        typeId: 4005,
      },
    ],
  },
  {
    typeId: 1408,
    type: "TSIM",
    nameTemplate: "Seturi totale în meci (Peste/Sub)",
    kind: "total",
    statistic: "sets",
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
    typeId: 1424,
    type: "X150",
    nameTemplate: "Total ași",
    kind: "total",
    statistic: "aces",
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
    typeId: 1431,
    type: "P1DF",
    nameTemplate: "<PLAYER_1> Duble greșeli",
    kind: "total",
    statistic: "double-faults",
    period: "match",
    subject: "player1",
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
    typeId: 1435,
    type: "P1FO",
    nameTemplate: "<PLAYER_1> Game-uri în primul set",
    kind: "total",
    statistic: "games",
    period: "set",
    subject: "player1",
    setNumber: 1,
    outcomes: [
      {
        role: "over",
        typeId: 3909,
      },
      {
        role: "under",
        typeId: 3910,
      },
    ],
  },
  {
    typeId: 1438,
    type: "P1W2",
    nameTemplate: "<PLAYER_1> să câștige 2 seturi",
    kind: "yes-no",
    statistic: "sets",
    period: "match",
    subject: "player1",
    condition: "wins-two-sets",
    outcomes: [
      {
        role: "yes",
      },
      {
        role: "no",
      },
    ],
  },
  {
    typeId: 1439,
    type: "P1WS",
    nameTemplate: "<PLAYER_1> să câștige un set",
    kind: "yes-no",
    statistic: "sets",
    period: "match",
    subject: "player1",
    condition: "wins-one-set",
    outcomes: [
      {
        role: "yes",
        typeId: 3845,
      },
      {
        role: "no",
        typeId: 3846,
      },
    ],
  },
  {
    typeId: 1440,
    type: "P1TA",
    nameTemplate: "<PLAYER_1> Ași",
    kind: "total",
    statistic: "aces",
    period: "match",
    subject: "player1",
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
    typeId: 1441,
    type: "X300",
    nameTemplate: "<PLAYER_1> Total ași - Primul set",
    kind: "total",
    statistic: "aces",
    period: "set",
    subject: "player1",
    setNumber: 1,
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
    typeId: 1444,
    type: "X313",
    nameTemplate: "<PLAYER_1> Total  duble greșeli - Primul set",
    kind: "total",
    statistic: "double-faults",
    period: "set",
    subject: "player1",
    setNumber: 1,
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
    typeId: 1445,
    type: "OUG1",
    nameTemplate: "<PLAYER_1> Total game-uri câștigate",
    kind: "total",
    statistic: "games",
    period: "match",
    subject: "player1",
    outcomes: [
      {
        role: "over",
        typeId: 3859,
      },
      {
        role: "under",
        typeId: 3860,
      },
    ],
  },
  {
    typeId: 1454,
    type: "P1SB",
    nameTemplate: "<PLAYER_1> Total break-uri",
    kind: "total",
    statistic: "breaks",
    period: "match",
    subject: "player1",
    outcomes: [
      {
        role: "over",
        typeId: 3882,
      },
      {
        role: "under",
        typeId: 3883,
      },
    ],
  },
  {
    typeId: 1462,
    type: "P2DF",
    nameTemplate: "<PLAYER_2> Duble greșeli",
    kind: "total",
    statistic: "double-faults",
    period: "match",
    subject: "player2",
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
    typeId: 1466,
    type: "P2FO",
    nameTemplate: "<PLAYER_2> Game-uri în primul set",
    kind: "total",
    statistic: "games",
    period: "set",
    subject: "player2",
    setNumber: 1,
    outcomes: [
      {
        role: "over",
        typeId: 3911,
      },
      {
        role: "under",
        typeId: 3912,
      },
    ],
  },
  {
    typeId: 1469,
    type: "P2W2",
    nameTemplate: "<PLAYER_2> să câștige 2 seturi",
    kind: "yes-no",
    statistic: "sets",
    period: "match",
    subject: "player2",
    condition: "wins-two-sets",
    outcomes: [
      {
        role: "yes",
      },
      {
        role: "no",
      },
    ],
  },
  {
    typeId: 1470,
    type: "P2WS",
    nameTemplate: "<PLAYER_2> să câștige un set",
    kind: "yes-no",
    statistic: "sets",
    period: "match",
    subject: "player2",
    condition: "wins-one-set",
    outcomes: [
      {
        role: "yes",
        typeId: 3847,
      },
      {
        role: "no",
        typeId: 3848,
      },
    ],
  },
  {
    typeId: 1471,
    type: "P2TA",
    nameTemplate: "<PLAYER_2> Ași",
    kind: "total",
    statistic: "aces",
    period: "match",
    subject: "player2",
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
    typeId: 1472,
    type: "X301",
    nameTemplate: "<PLAYER_2> Total ași - Primul set",
    kind: "total",
    statistic: "aces",
    period: "set",
    subject: "player2",
    setNumber: 1,
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
    typeId: 1475,
    type: "X314",
    nameTemplate: "<PLAYER_2> Total  duble greșeli - Primul set",
    kind: "total",
    statistic: "double-faults",
    period: "set",
    subject: "player2",
    setNumber: 1,
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
    typeId: 1476,
    type: "OUG2",
    nameTemplate: "<PLAYER_2> Total game-uri câștigate",
    kind: "total",
    statistic: "games",
    period: "match",
    subject: "player2",
    outcomes: [
      {
        role: "over",
        typeId: 3861,
      },
      {
        role: "under",
        typeId: 3862,
      },
    ],
  },
  {
    typeId: 1486,
    type: "P2SB",
    nameTemplate: "<PLAYER_2> Total break-uri",
    kind: "total",
    statistic: "breaks",
    period: "match",
    subject: "player2",
    outcomes: [
      {
        role: "over",
        typeId: 3884,
      },
      {
        role: "under",
        typeId: 3885,
      },
    ],
  },
  {
    typeId: 1512,
    type: "FSTO",
    nameTemplate: "Game-uri totale set (Set <SET>)",
    kind: "total",
    statistic: "games",
    period: "set",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 4037,
      },
      {
        role: "under",
        typeId: 4038,
      },
    ],
  },
  {
    typeId: 1531,
    type: "X193",
    nameTemplate: "Ași - Primul set",
    kind: "total",
    statistic: "aces",
    period: "set",
    subject: "total",
    setNumber: 1,
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
    typeId: 1534,
    type: "TDBF",
    nameTemplate: "Duble greșeli",
    kind: "total",
    statistic: "double-faults",
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
    typeId: 1535,
    type: "X198",
    nameTemplate: "Duble greșeli - Primul set",
    kind: "total",
    statistic: "double-faults",
    period: "set",
    subject: "total",
    setNumber: 1,
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
    typeId: 1541,
    type: "FTGO",
    nameTemplate: "Game-uri",
    kind: "total",
    statistic: "games",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 4039,
      },
      {
        role: "under",
        typeId: 4040,
      },
    ],
  },
  {
    typeId: 1551,
    type: "X229",
    nameTemplate: "Total break-uri",
    kind: "total",
    statistic: "breaks",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 4116,
      },
      {
        role: "under",
        typeId: 4117,
      },
    ],
  },
  {
    typeId: 3876,
    type: "X244",
    nameTemplate: "Total tie-break-uri",
    kind: "total",
    statistic: "tiebreaks",
    period: "match",
    subject: "total",
    outcomes: [
      {
        role: "over",
        typeId: 10098,
      },
      {
        role: "under",
        typeId: 10099,
      },
    ],
  },
] as const satisfies readonly BetanoTennisMarketDefinition[];
