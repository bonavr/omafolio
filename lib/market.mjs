// Market logic: which assets to fetch, whether a displayed price is trustworthy, when to poll
// next, and how quotes and provider health evolve. Pure: time is always a parameter (ms).

import { providerFor } from "./providers/index.mjs";

/** @typedef {import("./types.mjs").AssetRef} AssetRef */
/** @typedef {import("./types.mjs").Quote} Quote */
/** @typedef {import("./types.mjs").Health} Health */
/** @typedef {import("./types.mjs").Holding} Holding */
/** @typedef {import("./types.mjs").PriceState} PriceState */

/** A provider failing for longer than this makes its prices stale. */
export const STALE_AFTER_MS = 180000;
/** Poll interval for a Yahoo provider whose markets are all closed. */
export const CLOSED_POLL_MS = 900000;
/** Upper bound on failure backoff. */
export const MAX_BACKOFF_MS = 900000;
const BACKOFF_BASE_MS = 60000;

/**
 * Every asset worth fetching: holdings, then watch, then bar items, first occurrence wins.
 * The synthetic "portfolio" bar item is not an asset.
 * @param {{bar: AssetRef[], watch: AssetRef[]}} settings
 * @param {Holding[]} holdings
 * @returns {AssetRef[]}
 */
export function assetsToFetch(settings, holdings) {
  const all = [...holdings.map((h) => h.asset), ...settings.watch, ...settings.bar];
  return [...new Set(all)].filter((a) => a !== "portfolio");
}

/**
 * Yahoo FX symbols (`<CCY><BASE>=X`) needed to convert into `baseCurrency`: one per foreign
 * currency among listing currencies (crypto and FX quotes excluded) and holding cost currencies.
 * @param {Record<AssetRef, Quote>} quotes
 * @param {Holding[]} holdings
 * @param {string} baseCurrency
 * @returns {AssetRef[]} De-duplicated, alphabetical.
 */
export function fxPairs(quotes, holdings, baseCurrency) {
  const currencies = new Set();
  for (const quote of Object.values(quotes)) {
    if (quote.kind !== "crypto" && quote.kind !== "fx") currencies.add(quote.currency);
  }
  for (const h of holdings) if (h.costCurrency) currencies.add(h.costCurrency);
  currencies.delete(baseCurrency);
  return [...currencies].sort().map((c) => `${c}${baseCurrency}=X`);
}

/** Open when there is no session (crypto) or `start <= now < end`. */
function isOpen(/** @type {Quote} */ quote, /** @type {number} */ now) {
  const s = quote.session;
  return s === null || s === undefined || (s.start <= now && now < s.end);
}

/**
 * How a quote should be presented. Precedence: missing, closed, stale, live. A closed market
 * wins over failure or cache, since the price is expected not to move.
 * @param {Quote|undefined} quote
 * @param {Health|undefined} health Health of the quote's provider; undefined counts as healthy.
 * @param {number} now
 * @returns {PriceState}
 */
export function priceState(quote, health, now) {
  if (!quote) return "missing";
  if (!isOpen(quote, now)) return "closed";
  if (health && health.failingSince !== null && now - health.failingSince > STALE_AFTER_MS) return "stale";
  if (quote.fromCache) return "stale";
  return "live";
}

/**
 * Delay before a provider's next fetch. Failures back off from 60 s, doubling, capped at
 * MAX_BACKOFF_MS, whatever the market state. Otherwise Yahoo polls every CLOSED_POLL_MS when it
 * has quotes and none is open, and everything else polls every `refreshSeconds`.
 * @param {"yahoo"|"coingecko"|string} providerId
 * @param {Record<AssetRef, Quote>} quotes
 * @param {Health|undefined} health
 * @param {number} refreshSeconds
 * @param {number} now
 * @returns {number} Milliseconds.
 */
export function nextDelayMs(providerId, quotes, health, refreshSeconds, now) {
  const failures = health ? health.failures : 0;
  if (failures >= 1) return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
  if (providerId === "yahoo") {
    const own = Object.values(quotes).filter((quote) => providerFor(quote.asset).id === "yahoo");
    if (own.length > 0 && !own.some((quote) => isOpen(quote, now))) return CLOSED_POLL_MS;
  }
  return refreshSeconds * 1000;
}

/**
 * Overlays fresh quotes onto previous ones, so a quote missing from a response survives.
 * Fresh quotes are stored without `fromCache`. Does not mutate `previous`.
 * @param {Record<AssetRef, Quote>} previous
 * @param {Quote[]} fresh
 * @returns {Record<AssetRef, Quote>}
 */
export function mergeQuotes(previous, fresh) {
  const merged = { ...previous };
  for (const quote of fresh) {
    const { fromCache, ...rest } = quote;
    merged[quote.asset] = rest;
  }
  return merged;
}

/**
 * Requested assets that no returned quote covers.
 * @param {AssetRef[]} requested
 * @param {Quote[]} returned
 * @returns {AssetRef[]}
 */
export function notFound(requested, returned) {
  const got = new Set(returned.map((quote) => quote.asset));
  return requested.filter((a) => !got.has(a));
}

const NO_HEALTH = { failures: 0, failingSince: null, lastSuccess: null };

/**
 * @param {Health|undefined} health
 * @param {number} now
 * @returns {Health}
 */
export function recordSuccess(health, now) {
  return { failures: 0, failingSince: null, lastSuccess: now };
}

/**
 * Counts a failure; `failingSince` keeps its first value. Does not mutate `health`.
 * @param {Health|undefined} health
 * @param {number} now
 * @returns {Health}
 */
export function recordFailure(health, now) {
  const h = health || NO_HEALTH;
  return { failures: h.failures + 1, failingSince: h.failingSince === null ? now : h.failingSince, lastSuccess: h.lastSuccess };
}

/**
 * Whether a fetch is allowed: at least `refreshSeconds` since the last attempt (or none yet).
 * @param {number|null} lastAttemptAt
 * @param {number} refreshSeconds
 * @param {number} now
 */
export function canFetchNow(lastAttemptAt, refreshSeconds, now) {
  return lastAttemptAt === null || now - lastAttemptAt >= refreshSeconds * 1000;
}
