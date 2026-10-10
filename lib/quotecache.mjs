// The quote cache file (~/.cache/omafolio/quotes.json): the last known quote per
// asset, so prices show (marked stale) after a restart with no network. It holds
// symbols, prices and timestamps only, never quantities. The file is untrusted:
// anything that is not a well-formed Quote is dropped, and an unreadable file is
// an empty cache.

import { providerFor } from "./providers/index.mjs";

/** @typedef {import("./types.mjs").AssetRef} AssetRef */
/** @typedef {import("./types.mjs").Quote} Quote */

const KINDS = ["stock", "etf", "fund", "fx", "crypto"];

/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** @param {unknown} v @returns {v is string} */
const isStr = (v) => typeof v === "string";

/**
 * Whether `q` is a Quote for `asset` that its own provider could have produced.
 * @param {any} q
 * @param {AssetRef} asset
 */
function isQuote(q, asset) {
  if (q === null || typeof q !== "object" || Array.isArray(q) || q.asset !== asset) return false;
  if (!isNum(q.price) || !isNum(q.previousClose) || !isNum(q.asOf)) return false;
  if (!isStr(q.symbol) || !isStr(q.name) || !isStr(q.currency) || !KINDS.includes(q.kind)) return false;
  if (q.provider !== providerFor(asset).id) return false;
  const r = q.dayRange;
  if (r !== undefined && !(r !== null && typeof r === "object" && isNum(r.low) && isNum(r.high) && r.low <= r.high)) return false;
  const s = q.session;
  return s === null || (typeof s === "object" && !Array.isArray(s) && isNum(s.start) && isNum(s.end) && isStr(s.timezone)
    && (s.utcOffsetSeconds === undefined || isNum(s.utcOffsetSeconds)));
}

/**
 * Reads the cache file's text (null when there is no file). Returns every valid
 * entry, marked `fromCache: true`; invalid entries are skipped, and malformed or
 * missing text gives {}.
 * @param {string|null} text
 * @returns {Record<AssetRef, Quote>}
 */
export function parseQuoteCache(text) {
  /** @type {Record<AssetRef, Quote>} */
  const out = {};
  let data;
  try {
    data = JSON.parse(text === null ? "" : text);
  } catch (_) {
    return out;
  }
  const quotes = data !== null && typeof data === "object" ? data.quotes : null;
  if (quotes === null || typeof quotes !== "object" || Array.isArray(quotes)) return out;
  for (const asset of Object.keys(quotes)) {
    // A "__proto__" key would replace the result's prototype rather than add an entry.
    if (asset === "__proto__" || !isQuote(quotes[asset], asset)) continue;
    out[asset] = Object.assign({}, quotes[asset], { fromCache: true });
  }
  return out;
}

/**
 * The cache file's text for `quotes`, without `fromCache` flags. Equal quotes
 * give equal text, so a caller can skip rewriting an unchanged cache.
 * @param {Record<AssetRef, Quote>} quotes
 * @returns {string}
 */
export function serializeQuoteCache(quotes) {
  /** @type {Record<AssetRef, Quote>} */
  const plain = {};
  for (const asset of Object.keys(quotes)) {
    const copy = Object.assign({}, quotes[asset]);
    delete copy.fromCache;
    plain[asset] = copy;
  }
  return JSON.stringify({ quotes: plain });
}
