import type { SuperbetFootballMarketDefinition } from "./model/football-markets.interfaces.js";

/**
 * @file Lists verified two-outcome football markets and exact vendor name templates.
 */

// Keep vendor IDs, outcome roles, and name templates explicit; unknown markets stay excluded.
export const superbetFootballMarkets: readonly SuperbetFootballMarketDefinition[] =
  [
    {
      id: 529,
      nameTemplate: "Total goluri asiatice",
      kind: "asian-total",
      statistic: "goals",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 1359,
          role: "under",
        },
        {
          id: 1360,
          role: "over",
        },
      ],
    },
    {
      id: 530,
      nameTemplate: "Handicap asiatic",
      kind: "asian-handicap",
      statistic: "goals",
      period: "match",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 1361,
          role: "home",
        },
        {
          id: 1362,
          role: "away",
        },
      ],
    },
    {
      id: 535,
      nameTemplate: "Total goluri <AWAY_TEAM>",
      kind: "total",
      statistic: "goals",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 1406,
          role: "under",
        },
        {
          id: 1407,
          role: "over",
        },
      ],
    },
    {
      id: 539,
      nameTemplate: "Ambele echipe marchează (GG)",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "both",
      parameters: [],
      outcomes: [
        {
          id: 1440,
          role: "yes",
        },
        {
          id: 1441,
          role: "no",
        },
      ],
    },
    {
      id: 544,
      nameTemplate: "Total goluri <HOME_TEAM>",
      kind: "total",
      statistic: "goals",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 1461,
          role: "under",
        },
        {
          id: 1462,
          role: "over",
        },
      ],
    },
    {
      id: 549,
      nameTemplate: "A doua repriză - Ambele echipe marchează (GG)",
      kind: "yes-no",
      statistic: "goals",
      period: "second-half",
      subject: "both",
      parameters: [],
      outcomes: [
        {
          id: 1475,
          role: "yes",
        },
        {
          id: 1476,
          role: "no",
        },
      ],
    },
    {
      id: 550,
      nameTemplate: "Prima repriză - Total goluri asiatice",
      kind: "asian-total",
      statistic: "goals",
      period: "first-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 1477,
          role: "under",
        },
        {
          id: 1478,
          role: "over",
        },
      ],
    },
    {
      id: 559,
      nameTemplate: "A doua repriză - Total goluri asiatice",
      kind: "asian-total",
      statistic: "goals",
      period: "second-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 1509,
          role: "under",
        },
        {
          id: 1510,
          role: "over",
        },
      ],
    },
    {
      id: 564,
      nameTemplate: "Prima repriză - Handicap asiatic",
      kind: "asian-handicap",
      statistic: "goals",
      period: "first-half",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 1525,
          role: "home",
        },
        {
          id: 1526,
          role: "away",
        },
      ],
    },
    {
      id: 565,
      nameTemplate: "Prima repriză - Ambele echipe marchează (GG)",
      kind: "yes-no",
      statistic: "goals",
      period: "first-half",
      subject: "both",
      parameters: [],
      outcomes: [
        {
          id: 1527,
          role: "yes",
        },
        {
          id: 1528,
          role: "no",
        },
      ],
    },
    {
      id: 690,
      nameTemplate: "Total cartonașe",
      kind: "total",
      statistic: "cards",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 2003,
          role: "under",
        },
        {
          id: 2004,
          role: "over",
        },
      ],
    },
    {
      id: 693,
      nameTemplate:
        "Următoarele 10 minute - Total goluri de la <FROM>:00 la <TO>:59",
      kind: "total",
      statistic: "goals",
      period: "interval",
      subject: "total",
      parameters: ["from", "to", "total"],
      outcomes: [
        {
          id: 2017,
          role: "under",
        },
        {
          id: 2018,
          role: "over",
        },
      ],
      intervalMinutes: 10,
    },
    {
      id: 695,
      nameTemplate:
        "Următoarele 10 minute - Total cartonașe de la <FROM>:00 la <TO>:59",
      kind: "total",
      statistic: "cards",
      period: "interval",
      subject: "total",
      parameters: ["from", "to", "total"],
      outcomes: [
        {
          id: 2021,
          role: "under",
        },
        {
          id: 2022,
          role: "over",
        },
      ],
      intervalMinutes: 10,
    },
    {
      id: 700,
      nameTemplate: "Total cartonașe <HOME_TEAM>",
      kind: "total",
      statistic: "cards",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 2034,
          role: "under",
        },
        {
          id: 2035,
          role: "over",
        },
      ],
    },
    {
      id: 704,
      nameTemplate: "Total cornere",
      kind: "total",
      statistic: "corners",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 2042,
          role: "under",
        },
        {
          id: 2043,
          role: "over",
        },
      ],
    },
    {
      id: 708,
      nameTemplate: "Total cartonașe <AWAY_TEAM>",
      kind: "total",
      statistic: "cards",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 2052,
          role: "under",
        },
        {
          id: 2053,
          role: "over",
        },
      ],
    },
    {
      id: 711,
      nameTemplate:
        "Următoarele 10 minute - Total cornere de la <FROM>:00 la <TO>:59",
      kind: "total",
      statistic: "corners",
      period: "interval",
      subject: "total",
      parameters: ["from", "to", "total"],
      outcomes: [
        {
          id: 2059,
          role: "under",
        },
        {
          id: 2060,
          role: "over",
        },
      ],
      intervalMinutes: 10,
    },
    {
      id: 713,
      nameTemplate: "Total cornere <HOME_TEAM>",
      kind: "total",
      statistic: "corners",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 2064,
          role: "under",
        },
        {
          id: 2065,
          role: "over",
        },
      ],
    },
    {
      id: 715,
      nameTemplate:
        "Următoarele 5 minute - Total goluri de la <FROM>:00 la <TO>:59",
      kind: "total",
      statistic: "goals",
      period: "interval",
      subject: "total",
      parameters: ["from", "to", "total"],
      outcomes: [
        {
          id: 2068,
          role: "under",
        },
        {
          id: 2069,
          role: "over",
        },
      ],
      intervalMinutes: 5,
    },
    {
      id: 729,
      nameTemplate:
        "Următoarele 15 minute - Total goluri de la <FROM>:00 la <TO>:59",
      kind: "total",
      statistic: "goals",
      period: "interval",
      subject: "total",
      parameters: ["from", "to", "total"],
      outcomes: [
        {
          id: 2108,
          role: "under",
        },
        {
          id: 2109,
          role: "over",
        },
      ],
      intervalMinutes: 15,
    },
    {
      id: 732,
      nameTemplate: "Handicap cornere",
      kind: "handicap",
      statistic: "corners",
      period: "match",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 2116,
          role: "home",
        },
        {
          id: 2117,
          role: "away",
        },
      ],
    },
    {
      id: 733,
      nameTemplate: "Total cornere <AWAY_TEAM>",
      kind: "total",
      statistic: "corners",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 2118,
          role: "under",
        },
        {
          id: 2119,
          role: "over",
        },
      ],
    },
    {
      id: 872,
      nameTemplate: "Prima repriză - Handicap cornere",
      kind: "handicap",
      statistic: "corners",
      period: "first-half",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 3633,
          role: "home",
        },
        {
          id: 3634,
          role: "away",
        },
      ],
    },
    {
      id: 873,
      nameTemplate: "Prima repriză - Total cornere <HOME_TEAM>",
      kind: "total",
      statistic: "corners",
      period: "first-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 3635,
          role: "under",
        },
        {
          id: 3636,
          role: "over",
        },
      ],
    },
    {
      id: 878,
      nameTemplate: "Prima repriză - Total cornere",
      kind: "total",
      statistic: "corners",
      period: "first-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 3652,
          role: "under",
        },
        {
          id: 3653,
          role: "over",
        },
      ],
    },
    {
      id: 884,
      nameTemplate: "Prima repriză - Total cornere <AWAY_TEAM>",
      kind: "total",
      statistic: "corners",
      period: "first-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 3667,
          role: "under",
        },
        {
          id: 3668,
          role: "over",
        },
      ],
    },
    {
      id: 1007,
      nameTemplate: "Prima repriză - Total cartonașe <AWAY_TEAM>",
      kind: "total",
      statistic: "cards",
      period: "first-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 4273,
          role: "under",
        },
        {
          id: 4274,
          role: "over",
        },
      ],
    },
    {
      id: 1009,
      nameTemplate: "Prima repriză - Total cartonașe",
      kind: "total",
      statistic: "cards",
      period: "first-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 4277,
          role: "under",
        },
        {
          id: 4278,
          role: "over",
        },
      ],
    },
    {
      id: 1010,
      nameTemplate: "Prima repriză - Total cartonașe <HOME_TEAM>",
      kind: "total",
      statistic: "cards",
      period: "first-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 4279,
          role: "under",
        },
        {
          id: 4280,
          role: "over",
        },
      ],
    },
    {
      id: 1135,
      nameTemplate: "Câștigă <HOME_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "home",
      parameters: [],
      outcomes: [
        {
          id: 5867,
          role: "yes",
        },
        {
          id: 5868,
          role: "no",
        },
      ],
    },
    {
      id: 1136,
      nameTemplate: "Câștigă <AWAY_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "away",
      parameters: [],
      outcomes: [
        {
          id: 5871,
          role: "yes",
        },
        {
          id: 5872,
          role: "no",
        },
      ],
    },
    {
      id: 1137,
      nameTemplate: "Oricare echipă câștigă",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "total",
      parameters: [],
      outcomes: [
        {
          id: 5869,
          role: "yes",
        },
        {
          id: 5870,
          role: "no",
        },
      ],
    },
    {
      id: 2528,
      nameTemplate: "Marchează <HOME_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "home",
      parameters: [],
      outcomes: [
        {
          id: 6548,
          role: "yes",
        },
        {
          id: 6549,
          role: "no",
        },
      ],
    },
    {
      id: 2529,
      nameTemplate: "Prima repriză - Total goluri <HOME_TEAM>",
      kind: "total",
      statistic: "goals",
      period: "first-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 6550,
          role: "under",
        },
        {
          id: 6551,
          role: "over",
        },
      ],
    },
    {
      id: 2530,
      nameTemplate: "Marchează <AWAY_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "away",
      parameters: [],
      outcomes: [
        {
          id: 6552,
          role: "yes",
        },
        {
          id: 6553,
          role: "no",
        },
      ],
    },
    {
      id: 2531,
      nameTemplate: "Prima repriză - Total goluri <AWAY_TEAM>",
      kind: "total",
      statistic: "goals",
      period: "first-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 6554,
          role: "under",
        },
        {
          id: 6555,
          role: "over",
        },
      ],
    },
    {
      id: 200242,
      nameTemplate: "Prima repriză - Marchează <AWAY_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "first-half",
      subject: "away",
      parameters: [],
      outcomes: [
        {
          id: 100216,
          role: "yes",
        },
        {
          id: 100217,
          role: "no",
        },
      ],
    },
    {
      id: 200248,
      nameTemplate: "Total goluri în primele X minute",
      kind: "total",
      statistic: "goals",
      period: "first-minutes",
      subject: "total",
      parameters: ["total", "xnr"],
      outcomes: [
        {
          id: 100236,
          role: "under",
        },
        {
          id: 100235,
          role: "over",
        },
      ],
    },
    {
      id: 200255,
      nameTemplate: "Prima repriză - Marchează <HOME_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "first-half",
      subject: "home",
      parameters: [],
      outcomes: [
        {
          id: 150020,
          role: "yes",
        },
        {
          id: 150021,
          role: "no",
        },
      ],
    },
    {
      id: 200689,
      nameTemplate: "Handicap faulturi",
      kind: "handicap",
      statistic: "fouls",
      period: "match",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 151791,
          role: "home",
        },
        {
          id: 151792,
          role: "away",
        },
      ],
    },
    {
      id: 200690,
      nameTemplate: "Total faulturi",
      kind: "total",
      statistic: "fouls",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 151793,
          role: "under",
        },
        {
          id: 151794,
          role: "over",
        },
      ],
    },
    {
      id: 200691,
      nameTemplate: "Total faulturi <HOME_TEAM>",
      kind: "total",
      statistic: "fouls",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 151795,
          role: "under",
        },
        {
          id: 151796,
          role: "over",
        },
      ],
    },
    {
      id: 200692,
      nameTemplate: "Total faulturi <AWAY_TEAM>",
      kind: "total",
      statistic: "fouls",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 151797,
          role: "under",
        },
        {
          id: 151798,
          role: "over",
        },
      ],
    },
    {
      id: 200701,
      nameTemplate: "Handicap șuturi pe poartă",
      kind: "handicap",
      statistic: "shots-on-target",
      period: "match",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 151822,
          role: "home",
        },
        {
          id: 151823,
          role: "away",
        },
      ],
    },
    {
      id: 200702,
      nameTemplate: "Total șuturi pe poartă",
      kind: "total",
      statistic: "shots-on-target",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 151824,
          role: "under",
        },
        {
          id: 151825,
          role: "over",
        },
      ],
    },
    {
      id: 200703,
      nameTemplate: "Șuturi pe poartă <HOME_TEAM>",
      kind: "total",
      statistic: "shots-on-target",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 151826,
          role: "under",
        },
        {
          id: 151827,
          role: "over",
        },
      ],
    },
    {
      id: 200704,
      nameTemplate: "Șuturi pe poartă <AWAY_TEAM>",
      kind: "total",
      statistic: "shots-on-target",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 151828,
          role: "under",
        },
        {
          id: 151829,
          role: "over",
        },
      ],
    },
    {
      id: 200714,
      nameTemplate: "Total ofsaiduri",
      kind: "total",
      statistic: "offsides",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 151855,
          role: "under",
        },
        {
          id: 151856,
          role: "over",
        },
      ],
    },
    {
      id: 200715,
      nameTemplate: "Total ofsaiduri <HOME_TEAM>",
      kind: "total",
      statistic: "offsides",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 151857,
          role: "under",
        },
        {
          id: 151858,
          role: "over",
        },
      ],
    },
    {
      id: 200716,
      nameTemplate: "Total ofsaiduri <AWAY_TEAM>",
      kind: "total",
      statistic: "offsides",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 151859,
          role: "under",
        },
        {
          id: 151860,
          role: "over",
        },
      ],
    },
    {
      id: 200733,
      nameTemplate: "Fiecare echipă marchează 2+",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "both",
      parameters: [],
      outcomes: [
        {
          id: 151886,
          role: "yes",
        },
        {
          id: 151887,
          role: "no",
        },
      ],
    },
    {
      id: 200734,
      nameTemplate: "Total goluri",
      kind: "total",
      statistic: "goals",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 151888,
          role: "under",
        },
        {
          id: 151889,
          role: "over",
        },
      ],
    },
    {
      id: 200735,
      nameTemplate: "Prima repriză - Total goluri",
      kind: "total",
      statistic: "goals",
      period: "first-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 151890,
          role: "under",
        },
        {
          id: 151891,
          role: "over",
        },
      ],
    },
    {
      id: 200736,
      nameTemplate: "Handicap",
      kind: "handicap",
      statistic: "goals",
      period: "match",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 151892,
          role: "home",
        },
        {
          id: 151893,
          role: "away",
        },
      ],
    },
    {
      id: 200737,
      nameTemplate: "Prima repriză - Handicap",
      kind: "handicap",
      statistic: "goals",
      period: "first-half",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 151894,
          role: "home",
        },
        {
          id: 151895,
          role: "away",
        },
      ],
    },
    {
      id: 200738,
      nameTemplate: "A doua repriză - Total goluri",
      kind: "total",
      statistic: "goals",
      period: "second-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 151896,
          role: "under",
        },
        {
          id: 151897,
          role: "over",
        },
      ],
    },
    {
      id: 200739,
      nameTemplate: "A doua repriză - Handicap",
      kind: "handicap",
      statistic: "goals",
      period: "second-half",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 151898,
          role: "home",
        },
        {
          id: 151899,
          role: "away",
        },
      ],
    },
    {
      id: 200742,
      nameTemplate: "Total autogoluri",
      kind: "total",
      statistic: "own-goals",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 151993,
          role: "under",
        },
        {
          id: 151994,
          role: "over",
        },
      ],
    },
    {
      id: 200743,
      nameTemplate: "Total penaltiuri acordate",
      kind: "total",
      statistic: "penalties",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 151995,
          role: "under",
        },
        {
          id: 151996,
          role: "over",
        },
      ],
    },
    {
      id: 200751,
      nameTemplate: "GG în oricare repriză",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "both",
      parameters: [],
      outcomes: [
        {
          id: 152033,
          role: "yes",
        },
        {
          id: 152034,
          role: "no",
        },
      ],
    },
    {
      id: 200794,
      nameTemplate: "Câștigă ambele reprize <AWAY_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "away",
      parameters: [],
      outcomes: [
        {
          id: 152220,
          role: "yes",
        },
        {
          id: 152221,
          role: "no",
        },
      ],
    },
    {
      id: 200809,
      nameTemplate: "Câștigă oricare repriză <HOME_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "home",
      parameters: [],
      outcomes: [
        {
          id: 152275,
          role: "yes",
        },
        {
          id: 152276,
          role: "no",
        },
      ],
    },
    {
      id: 200811,
      nameTemplate: "Marchează în ambele reprize <HOME_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "home",
      parameters: [],
      outcomes: [
        {
          id: 152284,
          role: "yes",
        },
        {
          id: 152285,
          role: "no",
        },
      ],
    },
    {
      id: 200821,
      nameTemplate: "Marchează în ambele reprize <AWAY_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "away",
      parameters: [],
      outcomes: [
        {
          id: 152365,
          role: "yes",
        },
        {
          id: 152366,
          role: "no",
        },
      ],
    },
    {
      id: 200826,
      nameTemplate: "Câștigă oricare repriză <AWAY_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "away",
      parameters: [],
      outcomes: [
        {
          id: 152375,
          role: "yes",
        },
        {
          id: 152376,
          role: "no",
        },
      ],
    },
    {
      id: 200830,
      nameTemplate: "Câștigă ambele reprize <HOME_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "home",
      parameters: [],
      outcomes: [
        {
          id: 152388,
          role: "yes",
        },
        {
          id: 152389,
          role: "no",
        },
      ],
    },
    {
      id: 200940,
      nameTemplate: "A doua repriză - Marchează <HOME_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "second-half",
      subject: "home",
      parameters: [],
      outcomes: [
        {
          id: 152756,
          role: "yes",
        },
        {
          id: 152757,
          role: "no",
        },
      ],
    },
    {
      id: 200941,
      nameTemplate: "A doua repriză - Marchează <AWAY_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "second-half",
      subject: "away",
      parameters: [],
      outcomes: [
        {
          id: 152758,
          role: "yes",
        },
        {
          id: 152759,
          role: "no",
        },
      ],
    },
    {
      id: 201506,
      nameTemplate: "A doua repriză - Total goluri <HOME_TEAM>",
      kind: "total",
      statistic: "goals",
      period: "second-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 4201740,
          role: "under",
        },
        {
          id: 4201741,
          role: "over",
        },
      ],
    },
    {
      id: 201507,
      nameTemplate: "A doua repriză - Total goluri <AWAY_TEAM>",
      kind: "total",
      statistic: "goals",
      period: "second-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 4201742,
          role: "under",
        },
        {
          id: 4201743,
          role: "over",
        },
      ],
    },
    {
      id: 201526,
      nameTemplate: "Prima repriză - Total șuturi pe poartă",
      kind: "total",
      statistic: "shots-on-target",
      period: "first-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204672,
          role: "under",
        },
        {
          id: 4204673,
          role: "over",
        },
      ],
    },
    {
      id: 201527,
      nameTemplate: "Prima repriză - Total șuturi pe poartă <HOME_TEAM>",
      kind: "total",
      statistic: "shots-on-target",
      period: "first-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204674,
          role: "under",
        },
        {
          id: 4204675,
          role: "over",
        },
      ],
    },
    {
      id: 201568,
      nameTemplate: "Prima repriză - Total faulturi",
      kind: "total",
      statistic: "fouls",
      period: "first-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 161533,
          role: "under",
        },
        {
          id: 161534,
          role: "over",
        },
      ],
    },
    {
      id: 201569,
      nameTemplate: "Prima repriză - Total faulturi <HOME_TEAM>",
      kind: "total",
      statistic: "fouls",
      period: "first-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 161535,
          role: "under",
        },
        {
          id: 161536,
          role: "over",
        },
      ],
    },
    {
      id: 201570,
      nameTemplate: "Prima repriză - Total faulturi <AWAY_TEAM>",
      kind: "total",
      statistic: "fouls",
      period: "first-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 161537,
          role: "under",
        },
        {
          id: 161538,
          role: "over",
        },
      ],
    },
    {
      id: 201589,
      nameTemplate: "Handicap șuturi",
      kind: "handicap",
      statistic: "shots",
      period: "match",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 161591,
          role: "home",
        },
        {
          id: 161592,
          role: "away",
        },
      ],
    },
    {
      id: 201590,
      nameTemplate: "Total șuturi",
      kind: "total",
      statistic: "shots",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 161593,
          role: "under",
        },
        {
          id: 161594,
          role: "over",
        },
      ],
    },
    {
      id: 201591,
      nameTemplate: "Total șuturi <HOME_TEAM>",
      kind: "total",
      statistic: "shots",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 161595,
          role: "under",
        },
        {
          id: 161596,
          role: "over",
        },
      ],
    },
    {
      id: 201592,
      nameTemplate: "Total șuturi <AWAY_TEAM>",
      kind: "total",
      statistic: "shots",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 161597,
          role: "under",
        },
        {
          id: 161598,
          role: "over",
        },
      ],
    },
    {
      id: 201613,
      nameTemplate: "Prima repriză - Handicap șuturi",
      kind: "handicap",
      statistic: "shots",
      period: "first-half",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 161653,
          role: "home",
        },
        {
          id: 161654,
          role: "away",
        },
      ],
    },
    {
      id: 201614,
      nameTemplate: "Prima repriză - Total șuturi",
      kind: "total",
      statistic: "shots",
      period: "first-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 161655,
          role: "under",
        },
        {
          id: 161656,
          role: "over",
        },
      ],
    },
    {
      id: 201615,
      nameTemplate: "Prima repriză - Total șuturi <HOME_TEAM>",
      kind: "total",
      statistic: "shots",
      period: "first-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 161657,
          role: "under",
        },
        {
          id: 161658,
          role: "over",
        },
      ],
    },
    {
      id: 201616,
      nameTemplate: "Prima repriză - Total șuturi <AWAY_TEAM>",
      kind: "total",
      statistic: "shots",
      period: "first-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 161659,
          role: "under",
        },
        {
          id: 161660,
          role: "over",
        },
      ],
    },
    {
      id: 201659,
      nameTemplate: "Total deposedări",
      kind: "total",
      statistic: "tackles",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 161776,
          role: "under",
        },
        {
          id: 161777,
          role: "over",
        },
      ],
    },
    {
      id: 201660,
      nameTemplate: "Total deposedări <HOME_TEAM>",
      kind: "total",
      statistic: "tackles",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 161778,
          role: "under",
        },
        {
          id: 161779,
          role: "over",
        },
      ],
    },
    {
      id: 201661,
      nameTemplate: "Total deposedări <AWAY_TEAM>",
      kind: "total",
      statistic: "tackles",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 161780,
          role: "under",
        },
        {
          id: 161781,
          role: "over",
        },
      ],
    },
    {
      id: 201763,
      nameTemplate: "Prima repriză - Total ofsaiduri",
      kind: "total",
      statistic: "offsides",
      period: "first-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 162051,
          role: "under",
        },
        {
          id: 162052,
          role: "over",
        },
      ],
    },
    {
      id: 201764,
      nameTemplate: "Prima repriză - Total ofsaiduri <HOME_TEAM>",
      kind: "total",
      statistic: "offsides",
      period: "first-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 162053,
          role: "under",
        },
        {
          id: 162054,
          role: "over",
        },
      ],
    },
    {
      id: 201765,
      nameTemplate: "Prima repriză - Total ofsaiduri <AWAY_TEAM>",
      kind: "total",
      statistic: "offsides",
      period: "first-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 162055,
          role: "under",
        },
        {
          id: 162056,
          role: "over",
        },
      ],
    },
    {
      id: 230900,
      nameTemplate: "Total aruncări de la margine",
      kind: "total",
      statistic: "throw-ins",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204166,
          role: "under",
        },
        {
          id: 4204167,
          role: "over",
        },
      ],
    },
    {
      id: 230901,
      nameTemplate: "Total aruncări de la margine <HOME_TEAM>",
      kind: "total",
      statistic: "throw-ins",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204168,
          role: "under",
        },
        {
          id: 4204169,
          role: "over",
        },
      ],
    },
    {
      id: 230902,
      nameTemplate: "Total aruncări de la margine <AWAY_TEAM>",
      kind: "total",
      statistic: "throw-ins",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204170,
          role: "under",
        },
        {
          id: 4204171,
          role: "over",
        },
      ],
    },
    {
      id: 230909,
      nameTemplate: "Prima repriză - Total aruncări de margine",
      kind: "total",
      statistic: "throw-ins",
      period: "first-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204186,
          role: "under",
        },
        {
          id: 4204187,
          role: "over",
        },
      ],
    },
    {
      id: 230910,
      nameTemplate: "Prima repriză - Total aruncări de margine <HOME_TEAM>",
      kind: "total",
      statistic: "throw-ins",
      period: "first-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204188,
          role: "under",
        },
        {
          id: 4204189,
          role: "over",
        },
      ],
    },
    {
      id: 230911,
      nameTemplate: "Prima repriză - Total aruncări de margine <AWAY_TEAM>",
      kind: "total",
      statistic: "throw-ins",
      period: "first-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204190,
          role: "under",
        },
        {
          id: 4204191,
          role: "over",
        },
      ],
    },
    {
      id: 230933,
      nameTemplate: "Total lovituri de poartă",
      kind: "total",
      statistic: "goal-kicks",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204242,
          role: "under",
        },
        {
          id: 4204243,
          role: "over",
        },
      ],
    },
    {
      id: 230934,
      nameTemplate: "Total lovituri de poartă <HOME_TEAM>",
      kind: "total",
      statistic: "goal-kicks",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204244,
          role: "under",
        },
        {
          id: 4204245,
          role: "over",
        },
      ],
    },
    {
      id: 230935,
      nameTemplate: "Total lovituri de poartă <AWAY_TEAM>",
      kind: "total",
      statistic: "goal-kicks",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204246,
          role: "under",
        },
        {
          id: 4204247,
          role: "over",
        },
      ],
    },
    {
      id: 230942,
      nameTemplate: "Prima repriză - Total lovituri de poartă",
      kind: "total",
      statistic: "goal-kicks",
      period: "first-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204262,
          role: "under",
        },
        {
          id: 4204263,
          role: "over",
        },
      ],
    },
    {
      id: 230995,
      nameTemplate: "A doua repriză - Handicap asiatic",
      kind: "asian-handicap",
      statistic: "goals",
      period: "second-half",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 4204389,
          role: "home",
        },
        {
          id: 4204390,
          role: "away",
        },
      ],
    },
    {
      id: 231044,
      nameTemplate: "Ambele echipe primesc cartonaș roșu",
      kind: "yes-no",
      statistic: "red-cards",
      period: "match",
      subject: "both",
      parameters: [],
      outcomes: [
        {
          id: 4204534,
          role: "yes",
        },
        {
          id: 4204535,
          role: "no",
        },
      ],
    },
    {
      id: 231045,
      nameTemplate: "Fiecare echipă va primi peste X cartonașe",
      kind: "yes-no",
      statistic: "cards",
      period: "match",
      subject: "both",
      parameters: ["total"],
      outcomes: [
        {
          id: 4204536,
          role: "yes",
        },
        {
          id: 4204537,
          role: "no",
        },
      ],
    },
    {
      id: 232507,
      nameTemplate: "Înscrie goluri consecutive <HOME_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "home",
      parameters: [],
      outcomes: [
        {
          id: 4209296,
          role: "yes",
        },
        {
          id: 4209297,
          role: "no",
        },
      ],
    },
    {
      id: 232508,
      nameTemplate: "Înscrie goluri consecutive <AWAY_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "away",
      parameters: [],
      outcomes: [
        {
          id: 4209298,
          role: "yes",
        },
        {
          id: 4209299,
          role: "no",
        },
      ],
    },
    {
      id: 232509,
      nameTemplate: "Gol marcat în ambele reprize",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "total",
      parameters: [],
      outcomes: [
        {
          id: 4209300,
          role: "yes",
        },
        {
          id: 4209301,
          role: "no",
        },
      ],
    },
    {
      id: 232510,
      nameTemplate: "Egalitate în ambele reprize",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "total",
      parameters: [],
      outcomes: [
        {
          id: 4209302,
          role: "yes",
        },
        {
          id: 4209303,
          role: "no",
        },
      ],
    },
    {
      id: 232513,
      nameTemplate: "Câștigă după ce a fost condusă <HOME_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "home",
      parameters: [],
      outcomes: [
        {
          id: 4209308,
          role: "yes",
        },
        {
          id: 4209309,
          role: "no",
        },
      ],
    },
    {
      id: 232514,
      nameTemplate: "Câștigă după ce a fost condusă <AWAY_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "away",
      parameters: [],
      outcomes: [
        {
          id: 4209310,
          role: "yes",
        },
        {
          id: 4209311,
          role: "no",
        },
      ],
    },
    {
      id: 232515,
      nameTemplate: "Conduce oricând <HOME_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "home",
      parameters: [],
      outcomes: [
        {
          id: 4209312,
          role: "yes",
        },
        {
          id: 4209313,
          role: "no",
        },
      ],
    },
    {
      id: 232516,
      nameTemplate: "Conduce oricând <AWAY_TEAM>",
      kind: "yes-no",
      statistic: "goals",
      period: "match",
      subject: "away",
      parameters: [],
      outcomes: [
        {
          id: 4209314,
          role: "yes",
        },
        {
          id: 4209315,
          role: "no",
        },
      ],
    },
    {
      id: 232924,
      nameTemplate: "Handicap cartonașe",
      kind: "handicap",
      statistic: "cards",
      period: "match",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 4210197,
          role: "home",
        },
        {
          id: 4210198,
          role: "away",
        },
      ],
    },
    {
      id: 232978,
      nameTemplate: "Prima repriză - Total șuturi pe poartă <AWAY_TEAM>",
      kind: "total",
      statistic: "shots-on-target",
      period: "first-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 4210301,
          role: "under",
        },
        {
          id: 4210300,
          role: "over",
        },
      ],
    },
    {
      id: 233455,
      nameTemplate: "Total penaltiuri acordate pentru <HOME_TEAM>",
      kind: "total",
      statistic: "penalties",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 4581,
          role: "under",
        },
        {
          id: 4580,
          role: "over",
        },
      ],
    },
    {
      id: 233456,
      nameTemplate: "Total penaltiuri acordate pentru <AWAY_TEAM>",
      kind: "total",
      statistic: "penalties",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 4583,
          role: "under",
        },
        {
          id: 4582,
          role: "over",
        },
      ],
    },
    {
      id: 233489,
      nameTemplate: "Prima repriză - Total penaltiuri acordate",
      kind: "total",
      statistic: "penalties",
      period: "first-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 4595,
          role: "under",
        },
        {
          id: 4594,
          role: "over",
        },
      ],
    },
    {
      id: 233490,
      nameTemplate:
        "Prima repriză - Total penaltiuri acordate pentru <HOME_TEAM>",
      kind: "total",
      statistic: "penalties",
      period: "first-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 4597,
          role: "under",
        },
        {
          id: 4596,
          role: "over",
        },
      ],
    },
    {
      id: 233491,
      nameTemplate:
        "Prima repriză - Total penaltiuri acordate pentru <AWAY_TEAM>",
      kind: "total",
      statistic: "penalties",
      period: "first-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 4599,
          role: "under",
        },
        {
          id: 4598,
          role: "over",
        },
      ],
    },
    {
      id: 233527,
      nameTemplate: "Lovituri în bară",
      kind: "total",
      statistic: "woodwork",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 4677,
          role: "under",
        },
        {
          id: 4676,
          role: "over",
        },
      ],
    },
    {
      id: 233528,
      nameTemplate: "Lovește bara - <HOME_TEAM>",
      kind: "total",
      statistic: "woodwork",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 4679,
          role: "under",
        },
        {
          id: 4678,
          role: "over",
        },
      ],
    },
    {
      id: 233529,
      nameTemplate: "Lovește bara - <AWAY_TEAM>",
      kind: "total",
      statistic: "woodwork",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 4681,
          role: "under",
        },
        {
          id: 4680,
          role: "over",
        },
      ],
    },
    {
      id: 233941,
      nameTemplate: "Total cartonașe roșii",
      kind: "total",
      statistic: "red-cards",
      period: "match",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 6992,
          role: "under",
        },
        {
          id: 6993,
          role: "over",
        },
      ],
    },
    {
      id: 233942,
      nameTemplate: "Total cartonașe roșii <HOME_TEAM>",
      kind: "total",
      statistic: "red-cards",
      period: "match",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 6994,
          role: "under",
        },
        {
          id: 6995,
          role: "over",
        },
      ],
    },
    {
      id: 233943,
      nameTemplate: "Total cartonașe roșii <AWAY_TEAM>",
      kind: "total",
      statistic: "red-cards",
      period: "match",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 6996,
          role: "under",
        },
        {
          id: 6997,
          role: "over",
        },
      ],
    },
    {
      id: 233944,
      nameTemplate: "Prima repriză - Total cartonașe roșii",
      kind: "total",
      statistic: "red-cards",
      period: "first-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 6998,
          role: "under",
        },
        {
          id: 6999,
          role: "over",
        },
      ],
    },
    {
      id: 233945,
      nameTemplate: "Prima repriză - Total cartonașe roșii <HOME_TEAM>",
      kind: "total",
      statistic: "red-cards",
      period: "first-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 7000,
          role: "under",
        },
        {
          id: 7001,
          role: "over",
        },
      ],
    },
    {
      id: 233946,
      nameTemplate: "Prima repriză - Total cartonașe roșii <AWAY_TEAM>",
      kind: "total",
      statistic: "red-cards",
      period: "first-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 7002,
          role: "under",
        },
        {
          id: 7003,
          role: "over",
        },
      ],
    },
    {
      id: 238549,
      nameTemplate:
        "Următoarele 10 minute - Total lovituri de poartă de la <FROM>:00 la <TO>:59",
      kind: "total",
      statistic: "goal-kicks",
      period: "interval",
      subject: "total",
      parameters: ["from", "to", "total"],
      outcomes: [
        {
          id: 16358,
          role: "under",
        },
        {
          id: 16357,
          role: "over",
        },
      ],
      intervalMinutes: 10,
    },
    {
      id: 238567,
      nameTemplate:
        "Următoarele 10 minute - Total șuturi pe poartă de la <FROM>:00 la <TO>:59",
      kind: "total",
      statistic: "shots-on-target",
      period: "interval",
      subject: "total",
      parameters: ["from", "to", "total"],
      outcomes: [
        {
          id: 16403,
          role: "under",
        },
        {
          id: 16402,
          role: "over",
        },
      ],
      intervalMinutes: 10,
    },
    {
      id: 238573,
      nameTemplate:
        "Următoarele 10 minute - Total aruncări de la margine de la <FROM>:00 la <TO>:59",
      kind: "total",
      statistic: "throw-ins",
      period: "interval",
      subject: "total",
      parameters: ["from", "to", "total"],
      outcomes: [
        {
          id: 16418,
          role: "under",
        },
        {
          id: 16417,
          role: "over",
        },
      ],
      intervalMinutes: 10,
    },
    {
      id: 238591,
      nameTemplate:
        "Următoarele 10 minute - Total faulturi de la <FROM>:00 la <TO>:59",
      kind: "total",
      statistic: "fouls",
      period: "interval",
      subject: "total",
      parameters: ["from", "to", "total"],
      outcomes: [
        {
          id: 16463,
          role: "under",
        },
        {
          id: 16462,
          role: "over",
        },
      ],
      intervalMinutes: 10,
    },
    {
      id: 238707,
      nameTemplate: "Prima repriză - Handicap cartonașe",
      kind: "handicap",
      statistic: "cards",
      period: "first-half",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 931,
          role: "home",
        },
        {
          id: 932,
          role: "away",
        },
      ],
    },
    {
      id: 239801,
      nameTemplate: "Următorul minut - Gol de la <FROM>:00 la <TO>:59",
      kind: "yes-no",
      statistic: "goals",
      period: "interval",
      subject: "total",
      parameters: ["from", "to"],
      outcomes: [
        {
          id: 18459,
          role: "yes",
        },
        {
          id: 18460,
          role: "no",
        },
      ],
      intervalMinutes: 1,
    },
    {
      id: 239802,
      nameTemplate: "Următorul minut - Corner de la <FROM>:00 la <TO>:59",
      kind: "yes-no",
      statistic: "corners",
      period: "interval",
      subject: "total",
      parameters: ["from", "to"],
      outcomes: [
        {
          id: 18461,
          role: "yes",
        },
        {
          id: 18462,
          role: "no",
        },
      ],
      intervalMinutes: 1,
    },
    {
      id: 239803,
      nameTemplate: "Următorul minut - Cartonaș de la <FROM>:00 la <TO>:59",
      kind: "yes-no",
      statistic: "cards",
      period: "interval",
      subject: "total",
      parameters: ["from", "to"],
      outcomes: [
        {
          id: 18463,
          role: "yes",
        },
        {
          id: 18464,
          role: "no",
        },
      ],
      intervalMinutes: 1,
    },
    {
      id: 239804,
      nameTemplate: "Următorul minut - Fault de la <FROM>:00 la <TO>:59",
      kind: "yes-no",
      statistic: "fouls",
      period: "interval",
      subject: "total",
      parameters: ["from", "to"],
      outcomes: [
        {
          id: 18465,
          role: "yes",
        },
        {
          id: 18466,
          role: "no",
        },
      ],
      intervalMinutes: 1,
    },
    {
      id: 239805,
      nameTemplate:
        "Următorul minut - Lovitură de poartă de la <FROM>:00 la <TO>:59",
      kind: "yes-no",
      statistic: "goal-kicks",
      period: "interval",
      subject: "total",
      parameters: ["from", "to"],
      outcomes: [
        {
          id: 18467,
          role: "yes",
        },
        {
          id: 18468,
          role: "no",
        },
      ],
      intervalMinutes: 1,
    },
    {
      id: 239807,
      nameTemplate: "Următorul minut - Ofsaid de la <FROM>:00 la <TO>:59",
      kind: "yes-no",
      statistic: "offsides",
      period: "interval",
      subject: "total",
      parameters: ["from", "to"],
      outcomes: [
        {
          id: 18471,
          role: "yes",
        },
        {
          id: 18472,
          role: "no",
        },
      ],
      intervalMinutes: 1,
    },
    {
      id: 240082,
      nameTemplate: "A doua repriză - Total cornere",
      kind: "total",
      statistic: "corners",
      period: "second-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 18815,
          role: "under",
        },
        {
          id: 18814,
          role: "over",
        },
      ],
    },
    {
      id: 240083,
      nameTemplate: "A doua repriză - Total cornere <HOME_TEAM>",
      kind: "total",
      statistic: "corners",
      period: "second-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 18817,
          role: "under",
        },
        {
          id: 18816,
          role: "over",
        },
      ],
    },
    {
      id: 240084,
      nameTemplate: "A doua repriză - Total cornere <AWAY_TEAM>",
      kind: "total",
      statistic: "corners",
      period: "second-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 18819,
          role: "under",
        },
        {
          id: 18818,
          role: "over",
        },
      ],
    },
    {
      id: 240085,
      nameTemplate: "A doua repriză - Handicap cornere",
      kind: "handicap",
      statistic: "corners",
      period: "second-half",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 18820,
          role: "home",
        },
        {
          id: 18821,
          role: "away",
        },
      ],
    },
    {
      id: 240087,
      nameTemplate: "A doua repriză - Total cartonașe",
      kind: "total",
      statistic: "cards",
      period: "second-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 18826,
          role: "under",
        },
        {
          id: 18825,
          role: "over",
        },
      ],
    },
    {
      id: 240088,
      nameTemplate: "A doua repriză - Total cartonașe <HOME_TEAM>",
      kind: "total",
      statistic: "cards",
      period: "second-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 18828,
          role: "under",
        },
        {
          id: 18827,
          role: "over",
        },
      ],
    },
    {
      id: 240089,
      nameTemplate: "A doua repriză - Total cartonașe <AWAY_TEAM>",
      kind: "total",
      statistic: "cards",
      period: "second-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 18830,
          role: "under",
        },
        {
          id: 18829,
          role: "over",
        },
      ],
    },
    {
      id: 240090,
      nameTemplate: "A doua repriză - Handicap cartonașe",
      kind: "handicap",
      statistic: "cards",
      period: "second-half",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 18831,
          role: "home",
        },
        {
          id: 18832,
          role: "away",
        },
      ],
    },
    {
      id: 240092,
      nameTemplate: "A doua repriză - Total șuturi pe poartă",
      kind: "total",
      statistic: "shots-on-target",
      period: "second-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 18837,
          role: "under",
        },
        {
          id: 18836,
          role: "over",
        },
      ],
    },
    {
      id: 240093,
      nameTemplate: "A doua repriză - Total șuturi pe poartă <HOME_TEAM>",
      kind: "total",
      statistic: "shots-on-target",
      period: "second-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 18839,
          role: "under",
        },
        {
          id: 18838,
          role: "over",
        },
      ],
    },
    {
      id: 240094,
      nameTemplate: "A doua repriză - Total șuturi pe poartă <AWAY_TEAM>",
      kind: "total",
      statistic: "shots-on-target",
      period: "second-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 18841,
          role: "under",
        },
        {
          id: 18840,
          role: "over",
        },
      ],
    },
    {
      id: 240095,
      nameTemplate: "A doua repriză - Handicap șuturi pe poartă",
      kind: "handicap",
      statistic: "shots-on-target",
      period: "second-half",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 18842,
          role: "home",
        },
        {
          id: 18843,
          role: "away",
        },
      ],
    },
    {
      id: 240097,
      nameTemplate: "A doua repriză - Total șuturi",
      kind: "total",
      statistic: "shots",
      period: "second-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 18848,
          role: "under",
        },
        {
          id: 18847,
          role: "over",
        },
      ],
    },
    {
      id: 240098,
      nameTemplate: "A doua repriză - Total șuturi <HOME_TEAM>",
      kind: "total",
      statistic: "shots",
      period: "second-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 18850,
          role: "under",
        },
        {
          id: 18849,
          role: "over",
        },
      ],
    },
    {
      id: 240099,
      nameTemplate: "A doua repriză - Total șuturi <AWAY_TEAM>",
      kind: "total",
      statistic: "shots",
      period: "second-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 18852,
          role: "under",
        },
        {
          id: 18851,
          role: "over",
        },
      ],
    },
    {
      id: 240100,
      nameTemplate: "A doua repriză - Handicap șuturi",
      kind: "handicap",
      statistic: "shots",
      period: "second-half",
      subject: "total",
      parameters: ["hcp"],
      outcomes: [
        {
          id: 18853,
          role: "home",
        },
        {
          id: 18854,
          role: "away",
        },
      ],
    },
    {
      id: 240102,
      nameTemplate: "A doua repriză - Total faulturi",
      kind: "total",
      statistic: "fouls",
      period: "second-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 18859,
          role: "under",
        },
        {
          id: 18858,
          role: "over",
        },
      ],
    },
    {
      id: 240103,
      nameTemplate: "A doua repriză - Total faulturi <HOME_TEAM>",
      kind: "total",
      statistic: "fouls",
      period: "second-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 18861,
          role: "under",
        },
        {
          id: 18860,
          role: "over",
        },
      ],
    },
    {
      id: 240104,
      nameTemplate: "A doua repriză - Total faulturi <AWAY_TEAM>",
      kind: "total",
      statistic: "fouls",
      period: "second-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 18863,
          role: "under",
        },
        {
          id: 18862,
          role: "over",
        },
      ],
    },
    {
      id: 240112,
      nameTemplate: "A doua repriză - Total lovituri de poartă",
      kind: "total",
      statistic: "goal-kicks",
      period: "second-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 18881,
          role: "under",
        },
        {
          id: 18880,
          role: "over",
        },
      ],
    },
    {
      id: 240113,
      nameTemplate: "A doua repriză - Total lovituri de poartă <HOME_TEAM>",
      kind: "total",
      statistic: "goal-kicks",
      period: "second-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 18883,
          role: "under",
        },
        {
          id: 18882,
          role: "over",
        },
      ],
    },
    {
      id: 240114,
      nameTemplate: "A doua repriză - Total lovituri de poartă <AWAY_TEAM>",
      kind: "total",
      statistic: "goal-kicks",
      period: "second-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 18885,
          role: "under",
        },
        {
          id: 18884,
          role: "over",
        },
      ],
    },
    {
      id: 240117,
      nameTemplate: "A doua repriză - Total aruncări de margine",
      kind: "total",
      statistic: "throw-ins",
      period: "second-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 18892,
          role: "under",
        },
        {
          id: 18891,
          role: "over",
        },
      ],
    },
    {
      id: 240118,
      nameTemplate: "A doua repriză - Total aruncări de margine <HOME_TEAM>",
      kind: "total",
      statistic: "throw-ins",
      period: "second-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 18894,
          role: "under",
        },
        {
          id: 18893,
          role: "over",
        },
      ],
    },
    {
      id: 240119,
      nameTemplate: "A doua repriză - Total aruncări de margine <AWAY_TEAM>",
      kind: "total",
      statistic: "throw-ins",
      period: "second-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 18896,
          role: "under",
        },
        {
          id: 18895,
          role: "over",
        },
      ],
    },
    {
      id: 240122,
      nameTemplate: "A doua repriză - Total ofsaiduri",
      kind: "total",
      statistic: "offsides",
      period: "second-half",
      subject: "total",
      parameters: ["total"],
      outcomes: [
        {
          id: 18903,
          role: "under",
        },
        {
          id: 18902,
          role: "over",
        },
      ],
    },
    {
      id: 240123,
      nameTemplate: "A doua repriză - Total ofsaiduri <HOME_TEAM>",
      kind: "total",
      statistic: "offsides",
      period: "second-half",
      subject: "home",
      parameters: ["total"],
      outcomes: [
        {
          id: 18905,
          role: "under",
        },
        {
          id: 18904,
          role: "over",
        },
      ],
    },
    {
      id: 240124,
      nameTemplate: "A doua repriză - Total ofsaiduri <AWAY_TEAM>",
      kind: "total",
      statistic: "offsides",
      period: "second-half",
      subject: "away",
      parameters: ["total"],
      outcomes: [
        {
          id: 18907,
          role: "under",
        },
        {
          id: 18906,
          role: "over",
        },
      ],
    },
  ];
