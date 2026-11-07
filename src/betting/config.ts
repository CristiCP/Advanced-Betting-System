import type {
  BetanoBettingOptions,
  SuperbetBettingOptions,
} from "./model/config.interfaces.js";

export const betanoBettingConfig: BetanoBettingOptions = {
  origin: "https://ro.betano.com",
  cookie: "",
  stake: 2,
  maxAttempts: 3,
};

export const superbetBettingConfig: SuperbetBettingOptions = {
  origin: "https://api.web.production.betler.superbet.ro",
  siteOrigin: "https://superbet.ro",
  offerOrigin: "https://production-superbet-offer-ro.freetls.fastly.net",
  cookie: "",
  stake: 2,
  maxAttempts: 3,
};
