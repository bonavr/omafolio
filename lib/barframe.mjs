// What one frame of the bar ticker shows. Pure: the widget supplies the data and
// the time and draws the result.

import { assetLabel, formatBarValue, formatChange } from "./format.mjs";

/** @typedef {import("./types.mjs").AssetRef} AssetRef */

const DASH = "—";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** @type {Record<string, string>} */
const PROVIDER_NAMES = { yahoo: "Yahoo", coingecko: "CoinGecko" };
const PORTFOLIO_GLYPH = "󰄨";

/**
 * @typedef {object} BarFrame
 * @property {string} label "₿", a ticker, or the portfolio glyph.
 * @property {string} value Compact number, or "—" when there is no price; "…" before the first
 *   successful fetch.
 * @property {string} change "▲ 1.4%"-style day move; empty when there is none to show.
 * @property {"live"|"closed"|"stale"|"missing"} state How to draw it: "closed" is dimmed
 *   with a sleep glyph, "stale" adds a warning glyph.
 * @property {boolean} warn Whether the frame carries a warning glyph (stale or excluded assets).
 * @property {string} tooltip Explanation of what is stale or missing; empty when nothing is.
 */

/** @param {number} n */
const pad2 = (n) => (n < 10 ? "0" : "") + n;
/** @param {number} ms Epoch ms, shown in local time. */
const clock = (ms) => pad2(new Date(ms).getHours()) + ":" + pad2(new Date(ms).getMinutes());
/** @param {number} ms */
const dayAndClock = (ms) => DAYS[new Date(ms).getDay()] + " " + clock(ms);

/** @param {AssetRef} asset */
function shortName(asset) {
  return asset.startsWith("crypto:") ? asset.slice("crypto:".length) : asset;
}

/**
 * "VOO as of Fri 16:00 (Yahoo unavailable since 14:02)"; the parenthesis only when the
 * quote's provider is currently failing.
 * @param {AssetRef} asset
 * @param {Record<string, import("./types.mjs").Quote>} quotes
 * @param {Record<string, import("./types.mjs").Health>} health
 */
function staleEntry(asset, quotes, health) {
  const quote = quotes[asset];
  if (!quote) return shortName(asset);
  let text = quote.symbol + " as of " + dayAndClock(quote.asOf);
  const h = health[quote.provider];
  if (h && h.failingSince !== null && h.failingSince !== undefined) {
    text += " (" + (PROVIDER_NAMES[quote.provider] || quote.provider) + " unavailable since " + clock(h.failingSince) + ")";
  }
  return text;
}

/**
 * @param {AssetRef[]} stale
 * @param {AssetRef[]} excluded Assets left out of the value.
 * @param {Record<AssetRef, string>} states
 * @param {Record<string, import("./types.mjs").Quote>} quotes
 * @param {Record<string, import("./types.mjs").Health>} health
 */
function explain(stale, excluded, states, quotes, health) {
  const lines = [];
  if (stale.length > 0) {
    lines.push("Includes " + stale.length + " stale price" + (stale.length === 1 ? "" : "s") + ": "
      + stale.map((a) => staleEntry(a, quotes, health)).join(", "));
  }
  const notFound = excluded.filter((a) => states[a] === "missing").map(shortName);
  const noRate = excluded.filter((a) => states[a] !== "missing").map(shortName);
  if (notFound.length > 0) lines.push(notFound.join(", ") + " not found, not included");
  if (noRate.length > 0) lines.push(noRate.join(", ") + " has no exchange rate, not included");
  return lines.join("\n");
}

/**
 * The frame for one entry of the `bar` setting.
 * @param {string} item "portfolio" or an asset reference.
 * @param {object} data
 * @param {Record<string, import("./types.mjs").Quote>} data.quotes
 * @param {Record<string, string>} data.states
 * @param {import("./portfolio.mjs").PortfolioView} data.portfolio
 * @param {Record<string, import("./types.mjs").Health>} data.providerHealth
 * @param {boolean} data.loaded Whether any fetch has succeeded yet; until then an asset with no
 *   quote is "still loading", not "not found".
 * @returns {BarFrame}
 */
export function barFrame(item, data) {
  const { quotes, states, portfolio, providerHealth, loaded } = data;

  if (item === "portfolio") {
    const valued = portfolio.positions.filter((p) => p.value !== null);
    const allClosed = valued.length > 0 && valued.every((p) => p.state === "closed");
    const warn = portfolio.stale.length > 0 || portfolio.excluded.length > 0;
    const tooltip = explain(portfolio.stale, portfolio.excluded, states, quotes, providerHealth);
    if (valued.length === 0) {
      return { label: PORTFOLIO_GLYPH, value: loaded || portfolio.positions.length === 0 ? DASH : "…", change: "", state: "missing", warn, tooltip };
    }
    return {
      label: PORTFOLIO_GLYPH,
      value: formatBarValue(portfolio.total),
      change: formatChange(portfolio.dayChangePct),
      state: /** @type {BarFrame["state"]} */ (allClosed ? "closed" : (portfolio.stale.length > 0 ? "stale" : "live")),
      warn,
      tooltip,
    };
  }

  const quote = quotes[item];
  const state = states[item] || "missing";
  if (!quote || state === "missing") {
    const waiting = !loaded;
    return {
      label: shortName(item),
      value: waiting ? "…" : DASH,
      change: "",
      state: "missing",
      warn: false,
      tooltip: waiting ? "" : explain([], [item], { [item]: "missing" }, quotes, providerHealth),
    };
  }
  const change = quote.previousClose > 0 ? formatChange((quote.price - quote.previousClose) / quote.previousClose * 100) : DASH;
  return {
    label: assetLabel(quote),
    value: formatBarValue(quote.price),
    change,
    state: /** @type {BarFrame["state"]} */ (state),
    warn: state === "stale",
    tooltip: state === "stale" ? explain([item], [], states, quotes, providerHealth) : "",
  };
}
