// Provider routing. Assets starting with "crypto:" go to CoinGecko; everything else is a Yahoo
// symbol. Callers deal only in this module: it splits a mixed asset list per provider, builds
// each provider's requests and routes each response back to the provider that issued it.
// Search results from the two providers are merged by the caller, not here.

import { ProviderError } from "../types.mjs";
import yahoo from "./yahoo.mjs";
import coingecko from "./coingecko.mjs";

/** @typedef {import("../types.mjs").AssetRef} AssetRef */
/** @typedef {import("../types.mjs").Kind} Kind */
/** @typedef {import("../types.mjs").Range} Range */
/** @typedef {import("../types.mjs").Request} Request */
/** @typedef {import("../types.mjs").Quote} Quote */
/** @typedef {import("../types.mjs").Series} Series */
/** @typedef {import("../types.mjs").SearchResult} SearchResult */

const providers = [yahoo, coingecko];

/**
 * The provider responsible for an asset.
 * @param {AssetRef} asset
 */
export function providerFor(asset) {
  return asset.startsWith("crypto:") ? coingecko : yahoo;
}

/** Splits assets by provider, keeping input order within each. */
function partition(/** @type {AssetRef[]} */ assets) {
  return {
    yahoo: assets.filter((a) => providerFor(a) === yahoo),
    coingecko: assets.filter((a) => providerFor(a) === coingecko),
  };
}

/**
 * Requests for current quotes across providers; a provider with no assets contributes none.
 * @param {AssetRef[]} assets
 * @param {string} baseCurrency Upper-case ISO code crypto prices are quoted in.
 * @returns {Request[]}
 */
export function quoteRequests(assets, baseCurrency) {
  const p = partition(assets);
  return [...yahoo.quoteRequests(p.yahoo), ...coingecko.quoteRequests(p.coingecko, baseCurrency)];
}

/**
 * Requests for price history across providers.
 * @param {AssetRef[]} assets
 * @param {Range} range
 * @param {string} baseCurrency Upper-case ISO code crypto prices are quoted in.
 * @param {(asset: AssetRef) => Kind|undefined} kindOf Known kind of a Yahoo asset, or undefined.
 * @returns {Request[]}
 */
export function historyRequests(assets, range, baseCurrency, kindOf) {
  const p = partition(assets);
  return [...yahoo.historyRequests(p.yahoo, range, kindOf), ...coingecko.historyRequests(p.coingecko, range, baseCurrency)];
}

/**
 * One search request per provider.
 * @param {string} query
 * @returns {Request[]}
 */
export function searchRequests(query) {
  return providers.map((p) => p.searchRequest(query));
}

/**
 * Parses a response with the provider that issued `request`.
 * @param {Request} request
 * @param {number} status HTTP status.
 * @param {string} body
 * @returns {Quote[]|Series[]|SearchResult[]}
 * @throws {ProviderError} for an unknown `request.provider`, or whatever the provider throws.
 */
export function parse(request, status, body) {
  const p = providers.find((x) => x.id === request.provider);
  if (!p) throw new ProviderError(`Unknown provider "${request.provider}"`);
  return p.parse(request, status, body);
}
