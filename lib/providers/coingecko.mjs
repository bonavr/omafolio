// CoinGecko provider (keyless public API). Pure: builds Request objects for the caller to
// execute and parses the responses; it never touches the network.
//
// Assets are "crypto:<coingecko-id>". coins/markets serves quotes (one request for all coins),
// coins/<id>/market_chart serves history (one request per coin), search serves lookup.
// Prices are in the base currency the caller passes in (upper-case ISO code, e.g. "AUD").

import { ProviderError } from "../types.mjs";

/** @typedef {import("../types.mjs").AssetRef} AssetRef */
/** @typedef {import("../types.mjs").Range} Range */
/** @typedef {import("../types.mjs").Request} Request */
/** @typedef {import("../types.mjs").Quote} Quote */
/** @typedef {import("../types.mjs").Series} Series */
/** @typedef {import("../types.mjs").SearchResult} SearchResult */

const BASE = "https://api.coingecko.com/api/v3";
const PREFIX = "crypto:";

/** @type {Record<Range, number>} */
const DAYS = { "1D": 1, "1W": 7, "1M": 30, "1Y": 365 };

/** The CoinGecko id of an asset, or "" when it has no id (including a bare "crypto:"). */
const idOf = (/** @type {AssetRef} */ asset) => (asset.startsWith(PREFIX) ? asset.slice(PREFIX.length) : "");

/** Assets that carry a CoinGecko id; anything else is dropped. */
const withIds = (/** @type {AssetRef[]} */ assets) => assets.filter((a) => idOf(a) !== "");

/**
 * One request for the current price of every coin in `assets`. Empty input, or assets without
 * an id, give [].
 * @param {AssetRef[]} assets "crypto:<id>" references.
 * @param {string} baseCurrency Upper-case ISO code the prices are quoted in.
 * @returns {Request[]}
 */
function quoteRequests(assets, baseCurrency) {
  const valid = withIds(assets);
  if (valid.length === 0) return [];
  const ids = valid.map((a) => encodeURIComponent(idOf(a))).join(",");
  return [
    {
      provider: "coingecko",
      type: "quotes",
      url: `${BASE}/coins/markets?vs_currency=${baseCurrency.toLowerCase()}&ids=${ids}`,
      assets: valid,
    },
  ];
}

/**
 * Requests for price history over `range`, one per coin (market_chart takes a single coin).
 * @param {AssetRef[]} assets "crypto:<id>" references.
 * @param {Range} range
 * @param {string} baseCurrency Upper-case ISO code the prices are quoted in.
 * @returns {Request[]}
 */
function historyRequests(assets, range, baseCurrency) {
  return withIds(assets).map((asset) => ({
    provider: "coingecko",
    type: "history",
    url: `${BASE}/coins/${encodeURIComponent(idOf(asset))}/market_chart?vs_currency=${baseCurrency.toLowerCase()}&days=${DAYS[range]}`,
    assets: [asset],
    range,
  }));
}

/**
 * Request for a coin search; the query is URL-encoded.
 * @param {string} query
 * @returns {Request}
 */
function searchRequest(query) {
  return { provider: "coingecko", type: "search", url: `${BASE}/search?query=${encodeURIComponent(query)}`, assets: [] };
}

/** @param {string} body @returns {any} */
function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch (_) {
    throw new ProviderError("CoinGecko returned a non-JSON body");
  }
}

/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** The upper-case currency a request was priced in, read back from its own vs_currency parameter. */
function currencyOf(/** @type {Request} */ request) {
  const m = /[?&]vs_currency=([^&]+)/.exec(request.url);
  return m ? decodeURIComponent(m[1]).toUpperCase() : "";
}

/** @returns {Quote[]} */
function parseQuotes(/** @type {Request} */ request, /** @type {any} */ json) {
  if (!Array.isArray(json)) throw new ProviderError("Unexpected CoinGecko markets response shape");
  const currency = currencyOf(request);
  /** @type {Quote[]} */
  const quotes = [];
  for (const c of json) {
    if (typeof c?.id !== "string" || typeof c.symbol !== "string" || !isNum(c.current_price) || !isNum(c.price_change_24h)) continue;
    const asOf = typeof c.last_updated === "string" ? Date.parse(c.last_updated) : NaN;
    if (!isNum(asOf)) continue;
    quotes.push({
      asset: PREFIX + c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name || c.symbol.toUpperCase(),
      price: c.current_price,
      previousClose: c.current_price - c.price_change_24h,
      currency,
      kind: "crypto",
      asOf,
      session: null,
      provider: "coingecko",
    });
  }
  return quotes;
}

/** @returns {Series[]} */
function parseHistory(/** @type {Request} */ request, /** @type {any} */ json) {
  if (!Array.isArray(json?.prices)) throw new ProviderError("Unexpected CoinGecko market_chart response shape");
  /** @type {Array<[number, number]>} */
  const points = [];
  for (const p of json.prices) {
    if (isNum(p?.[0]) && isNum(p[1])) points.push([p[0], p[1]]);
  }
  return [{ asset: request.assets[0], currency: currencyOf(request), points }];
}

/** @returns {SearchResult[]} */
function parseSearch(/** @type {any} */ json) {
  if (!Array.isArray(json?.coins)) throw new ProviderError("Unexpected CoinGecko search response shape");
  /** @type {SearchResult[]} */
  const results = [];
  for (const c of json.coins) {
    if (typeof c?.id !== "string" || c.id === "" || typeof c.symbol !== "string") continue;
    results.push({ asset: PREFIX + c.id, symbol: c.symbol.toUpperCase(), name: c.name || c.symbol, kind: "crypto", exchange: "" });
  }
  return results;
}

/**
 * Parses the response to `request`. Returns Quote[] for "quotes", Series[] for "history" (one
 * series) and SearchResult[] for "search". Coins with unusable data (missing price, 24h change
 * or update time) are omitted rather than returned as NaN; ids CoinGecko does not know are
 * simply absent from its answer, so they are absent here too.
 * @param {Request} request
 * @param {number} status HTTP status.
 * @param {string} body
 * @returns {Quote[]|Series[]|SearchResult[]}
 * @throws {ProviderError} on any non-200 status (429 is the keyless rate limit), a non-JSON
 *   body, or an unexpected shape.
 */
function parse(request, status, body) {
  if (status !== 200) throw new ProviderError(`CoinGecko returned HTTP ${status}`);
  const json = parseJson(body);
  if (request.type === "quotes") return parseQuotes(request, json);
  if (request.type === "history") return parseHistory(request, json);
  return parseSearch(json);
}

/** The CoinGecko provider. */
const Provider = { id: "coingecko", quoteRequests, historyRequests, searchRequest, parse };
export default Provider;
