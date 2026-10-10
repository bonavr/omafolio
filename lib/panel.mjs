// What the panel shows: the hero (the portfolio total, or one asset), the rows of
// each tab, the market status line, and the chart series and its geometry. Pure:
// the panel passes in the market data and the time, and only draws the result.

import {
  changeDirection,
  formatChange,
  formatDayRange,
  formatMoney,
  formatPrice,
  formatQuantity,
  formatSigned,
  formatWeekdayAt,
  formatWhen,
  pctDirection,
} from "./format.mjs";
import { attempted, barFrame, explain, isFailing, providerName, shortName } from "./barframe.mjs";
import { combinedSeries, rangeChange } from "./portfolio.mjs";
import { providerFor } from "./providers/index.mjs";

/** @typedef {import("./types.mjs").AssetRef} AssetRef */
/** @typedef {import("./types.mjs").Quote} Quote */
/** @typedef {import("./types.mjs").Series} Series */
/** @typedef {import("./types.mjs").Holding} Holding */
/** @typedef {import("./types.mjs").Health} Health */
/** @typedef {import("./types.mjs").Range} Range */
/** @typedef {import("./portfolio.mjs").PortfolioView} PortfolioView */
/** @typedef {import("./portfolio.mjs").PositionView} PositionView */
/** @typedef {"up"|"down"|"flat"} Direction */

/**
 * Everything the panel knows, as MarketService publishes it.
 * @typedef {object} PanelData
 * @property {Record<AssetRef, Quote>} quotes
 * @property {Record<AssetRef, string>} states Price state per asset.
 * @property {PortfolioView} portfolio
 * @property {Holding[]} holdings
 * @property {AssetRef[]} watch
 * @property {Record<string, Health>} providerHealth
 * @property {string} baseCurrency
 * @property {number} now Epoch ms.
 */

/**
 * One line of a tab's list.
 * @typedef {object} PanelRow
 * @property {AssetRef} asset
 * @property {string} label "₿ BTC" for bitcoin, the ticker otherwise.
 * @property {boolean} crypto Whether the asset is a coin (drawn in the accent colour).
 * @property {string} value Base-currency value (portfolio) or price (watchlist); "…" while
 *   its provider has not answered, "not found" for an unknown symbol, "—" otherwise when
 *   there is no number to show.
 * @property {string} change Day move ("▲ 0.6%"); empty when there is no number.
 * @property {Direction} direction
 * @property {string} tooltip What is stale or missing; empty when nothing is.
 */

/**
 * The block above the chart.
 * @typedef {object} Hero
 * @property {string} title Caption line: "Total value · AUD", or "VOO · Vanguard S&P 500 ETF".
 * @property {string} value The big number.
 * @property {string} change Day move; empty when there is none.
 * @property {Direction} direction
 * @property {string} subLabel Muted start of the second line ("Unrealised", "12 × US$715.59").
 * @property {string} sub Unrealised gain ("+$16,630 · ▲ 86.1%"); empty when not a holding.
 * @property {Direction} subDirection
 * @property {Array<{label: string, value: string}>} details Stat cells under the chart.
 * @property {string} asOf "as of 16:00" for one asset; empty for the portfolio.
 * @property {string} tooltip What is stale or missing; empty when nothing is.
 */

/**
 * How a list names an asset: "₿ BTC" for bitcoin, the quote's ticker, or the
 * reference without its provider prefix before any quote has arrived.
 * @param {AssetRef} asset
 * @param {Quote|null|undefined} quote
 */
export function rowLabel(asset, quote) {
  if (asset === "crypto:bitcoin") return "₿ BTC";
  return quote ? quote.symbol : shortName(asset);
}

/**
 * Stand-in for a number an asset cannot show: "…" until its provider has answered,
 * "not found" when the provider answered without it, "—" during an outage or when
 * only an exchange rate is missing.
 * @param {AssetRef} asset
 * @param {PanelData} data
 */
function placeholder(asset, data) {
  if (!attempted(asset, data.providerHealth)) return "…";
  if (data.states[asset] === "missing" && !isFailing(data.providerHealth[providerFor(asset).id])) return "not found";
  return "—";
}

/** @param {Quote} quote */
function dayPct(quote) {
  return quote.previousClose > 0 ? (quote.price - quote.previousClose) / quote.previousClose * 100 : null;
}

/** @param {Quote|null|undefined} quote @param {string} state */
const priced = (quote, state) => !!quote && state !== "missing";

/**
 * Tooltip for one held asset: its stale price (and its stale exchange rate), or why
 * it is left out of the total.
 * @param {PositionView} position
 * @param {PanelData} data
 */
function positionTooltip(position, data) {
  const stale = position.state === "stale" ? [position.asset] : [];
  const pair = position.quote ? position.quote.currency + data.baseCurrency + "=X" : "";
  if (position.value !== null && pair !== "" && data.states[pair] === "stale") stale.push(pair);
  const excluded = position.value === null ? [position.asset] : [];
  return explain(stale, excluded, data.states, data.quotes, data.providerHealth);
}

/**
 * Tooltip for one watched asset: its stale price, the outage hiding it, or that the
 * symbol does not exist.
 * @param {AssetRef} asset
 * @param {PanelData} data
 */
function watchTooltip(asset, data) {
  const state = data.states[asset] || "missing";
  if (state === "stale") return explain([asset], [], data.states, data.quotes, data.providerHealth);
  if (priced(data.quotes[asset], state) || !attempted(asset, data.providerHealth)) return "";
  const id = providerFor(asset).id;
  // The outage line, worded as on the bar; "not found" only when the provider answered.
  if (isFailing(data.providerHealth[id])) return explain([], [asset], { [asset]: "missing" }, data.quotes, data.providerHealth);
  return shortName(asset) + " not found";
}

/**
 * Rows of the Portfolio tab: every holding, valued ones by value descending, then
 * the ones left out of the total.
 * @param {PanelData} data
 * @returns {PanelRow[]}
 */
export function portfolioRows(data) {
  const base = data.baseCurrency;
  return data.portfolio.positions.map((p) => {
    const change = p.value !== null ? formatChange(p.dayChangePct) : "";
    return {
      asset: p.asset,
      label: rowLabel(p.asset, p.quote),
      crypto: providerFor(p.asset).id === "coingecko",
      value: p.value !== null ? formatMoney(p.value, base, base) : placeholder(p.asset, data),
      change,
      direction: changeDirection(change),
      tooltip: positionTooltip(p, data),
    };
  });
}

/**
 * Rows of the Watchlist tab, in `watch` order: price in the asset's own currency and
 * day move.
 * @param {PanelData} data
 * @returns {PanelRow[]}
 */
export function watchRows(data) {
  return data.watch.map((asset) => {
    const quote = data.quotes[asset];
    const ok = priced(quote, data.states[asset] || "missing");
    const change = ok ? formatChange(dayPct(quote)) : "";
    return {
      asset,
      label: rowLabel(asset, quote),
      crypto: providerFor(asset).id === "coingecko",
      value: ok ? formatPrice(quote.price, quote.currency, data.baseCurrency) : placeholder(asset, data),
      change,
      direction: changeDirection(change),
      tooltip: watchTooltip(asset, data),
    };
  });
}

/**
 * The portfolio hero: total, day move and unrealised gain, with the bar's tooltip
 * for the total.
 * @param {PanelData} data
 * @returns {Hero}
 */
export function portfolioHero(data) {
  const base = data.baseCurrency;
  const p = data.portfolio;
  const frame = barFrame("portfolio", data);
  const valued = p.positions.some((x) => x.value !== null);
  const change = valued ? formatChange(p.dayChangePct) : "";
  const gainPct = formatChange(p.gainPct);
  return {
    title: "Total value · " + base,
    value: valued ? formatMoney(p.total, base, base) : frame.value,
    change,
    direction: changeDirection(change),
    subLabel: valued ? "Unrealised" : "",
    sub: valued ? formatSigned(p.gain, base, base) + " · " + gainPct : "",
    subDirection: changeDirection(gainPct),
    details: [],
    asOf: "",
    tooltip: frame.tooltip,
  };
}

/**
 * Weight in the portfolio: one decimal below 10%, whole percent from there.
 * @param {number|null} weight
 */
function formatWeight(weight) {
  if (weight === null || !Number.isFinite(weight)) return "—";
  return (weight < 10 ? weight.toFixed(1) : String(Math.round(weight))) + "%";
}

/**
 * The hero for one asset. With `holding` (the Portfolio tab) it is the position: its
 * value in the base currency, quantity × price, unrealised gain, average cost and
 * weight. Without it (the Watchlist tab) it is the asset alone: its price and day
 * move. Both show the day range and when the price is from.
 * @param {AssetRef} asset
 * @param {PanelData} data
 * @param {boolean} holding
 * @returns {Hero}
 */
export function assetHero(asset, data, holding) {
  const base = data.baseCurrency;
  const quote = data.quotes[asset] || null;
  const ok = priced(quote, data.states[asset] || "missing");
  const position = holding ? data.portfolio.positions.find((p) => p.asset === asset) || null : null;
  const held = holding ? data.holdings.find((h) => h.asset === asset) || null : null;
  const title = quote ? (quote.name && quote.name !== quote.symbol ? quote.symbol + " · " + quote.name : quote.symbol) : shortName(asset);

  /** @type {Array<{label: string, value: string}>} */
  const details = [];
  let value;
  let change = "";
  let subLabel = "";
  let sub = "";
  let subDirection = /** @type {Direction} */ ("flat");
  if (position) {
    value = position.value !== null ? formatMoney(position.value, base, base) : placeholder(asset, data);
    if (position.value !== null) change = formatChange(position.dayChangePct);
    if (ok && quote) subLabel = formatQuantity(position.quantity) + " × " + formatPrice(quote.price, quote.currency, base);
    if (position.gain !== null) {
      const gainPct = formatChange(position.gainPct);
      sub = formatSigned(position.gain, base, base) + " · " + gainPct;
      subDirection = changeDirection(gainPct);
    }
    const costCurrency = held && (held.costCurrency || (quote ? quote.currency : ""));
    details.push({ label: "Avg cost", value: held && costCurrency ? formatPrice(held.cost, costCurrency, base) : "—" });
    details.push({ label: "Weight", value: formatWeight(position.weight) });
  } else {
    value = ok && quote ? formatPrice(quote.price, quote.currency, base) : placeholder(asset, data);
    if (ok && quote) change = formatChange(dayPct(quote));
  }
  const range = ok && quote && quote.dayRange ? formatDayRange(quote.dayRange.low, quote.dayRange.high, quote.currency) : "—";
  details.push({ label: "Day range", value: range });

  return {
    title,
    value,
    change,
    direction: changeDirection(change),
    subLabel,
    sub,
    subDirection,
    details,
    asOf: quote ? "as of " + formatWhen(quote.asOf, data.now) : "",
    tooltip: position ? positionTooltip(position, data) : watchTooltip(asset, data),
  };
}

/**
 * Lines under the range picker, for a tab showing `assets`: an outage line per
 * failing provider ("Stock prices unavailable since 14:02 (Yahoo)"), and when every
 * stock quote among `assets` is from a closed market, "󰒲 US market closed · last close
 * Fri" (the weekday of the latest of those quotes on its exchange's calendar, or in
 * local time when the exchange's UTC offset is unknown). Exchange rates do not count as
 * stock quotes. It never predicts the next open.
 * @param {AssetRef[]} assets
 * @param {PanelData} data
 * @returns {string[]}
 */
export function statusLines(assets, data) {
  const lines = [];
  const yahoo = data.providerHealth.yahoo;
  const coingecko = data.providerHealth.coingecko;
  if (isFailing(yahoo)) {
    lines.push("Stock prices unavailable since " + formatWhen(yahoo.failingSince, data.now) + " (Yahoo)");
  } else {
    const stocks = assets
      .map((a) => data.quotes[a])
      .filter((q) => q && q.provider === "yahoo" && q.kind !== "fx");
    if (stocks.length > 0 && stocks.every((q) => data.states[q.asset] === "closed")) {
      const latest = stocks.reduce((a, b) => (b.asOf > a.asOf ? b : a));
      const offset = latest.session ? latest.session.utcOffsetSeconds : undefined;
      const us = stocks.every((q) => q.session !== null && q.session.timezone.indexOf("America/") === 0);
      lines.push("󰒲 " + (us ? "US market" : "Markets") + " closed · last close " + formatWeekdayAt(latest.asOf, offset));
    }
  }
  if (isFailing(coingecko)) {
    lines.push("Crypto prices unavailable since " + formatWhen(coingecko.failingSince, data.now) + " (CoinGecko)");
  }
  return lines;
}

/**
 * Assets whose history the panel needs: every holding, the exchange rates that value
 * them (`fx`), and the watchlist, once each.
 * @param {PanelData} data
 * @param {AssetRef[]} fx
 * @returns {AssetRef[]}
 */
export function historyAssets(data, fx) {
  /** @type {AssetRef[]} */
  const out = [];
  for (const a of data.holdings.map((h) => h.asset).concat(fx, data.watch)) if (out.indexOf(a) < 0) out.push(a);
  return out;
}

/** Fewest points that make a chart (and count as history for one asset). */
const MIN_CHART_POINTS = 2;

/**
 * The portfolio's value over `range`, or null until every valued holding has a
 * series of at least two points: a chart summed over some holdings only would
 * misstate the total.
 * Holdings left out of the total are left out of the chart too.
 * @param {PanelData} data
 * @param {Record<AssetRef, Series>} seriesByAsset
 * @param {Range} range
 * @returns {Series|null}
 */
export function portfolioSeries(data, seriesByAsset, range) {
  const valued = data.portfolio.positions.filter((p) => p.value !== null).map((p) => p.asset);
  if (valued.length === 0) return null;
  if (valued.some((a) => !hasHistory(seriesByAsset[a]))) return null;
  const holdings = data.holdings.filter((h) => valued.indexOf(h.asset) >= 0);
  return combinedSeries(holdings, seriesByAsset, data.quotes, range, data.baseCurrency);
}

/** @param {Series|undefined} series */
function hasHistory(series) {
  return !!series && series.points.length >= MIN_CHART_POINTS;
}

/**
 * Which way a series moved over its span, as its percentage change reads once shown
 * (format.pctDirection): "flat" when that rounds to 0.0%, starts at 0, or there are
 * fewer than two points.
 * @param {Series|null|undefined} series
 * @returns {Direction}
 */
export function seriesDirection(series) {
  return series ? pctDirection(rangeChange(series).pct) : "flat";
}

/**
 * What the chart says while it has nothing to draw. `asset` is the asset in the hero, or
 * "" for the portfolio (whose chart needs every valued holding). When an asset lacking
 * history belongs to a failing provider: "History unavailable (CoinGecko)" (both
 * providers named when both are); otherwise "No history yet".
 * @param {PanelData} data
 * @param {Record<AssetRef, Series>} seriesByAsset
 * @param {AssetRef} asset
 */
export function chartNote(data, seriesByAsset, asset) {
  const needed = asset !== "" ? [asset] : data.portfolio.positions.filter((p) => p.value !== null).map((p) => p.asset);
  /** @type {string[]} */
  const failing = [];
  for (const a of needed) {
    if (hasHistory(seriesByAsset[a])) continue;
    const id = providerFor(a).id;
    if (isFailing(data.providerHealth[id]) && failing.indexOf(id) < 0) failing.push(id);
  }
  return failing.length > 0 ? "History unavailable (" + failing.map(providerName).join(", ") + ")" : "No history yet";
}

/**
 * The move over the chart's span, e.g. "▲ 7.9% over 1M"; empty without a usable series.
 * @param {Series|null|undefined} series
 * @param {Range} range
 * @returns {{text: string, direction: Direction}}
 */
export function rangeLine(series, range) {
  if (!series) return { text: "", direction: "flat" };
  const { pct } = rangeChange(series);
  if (pct === null) return { text: "", direction: "flat" };
  const change = formatChange(pct);
  return { text: change + " over " + range, direction: changeDirection(change) };
}

/**
 * Pixel positions [x, y] for drawing `points` in a `width` × `height` box: evenly
 * spaced left to right (so closed-market gaps take no room), the lowest value at
 * the bottom and the highest at the top, `pad` pixels in from both. A level series
 * is a line across the middle. Fewer than two points give [].
 * @param {Array<[number, number]>} points
 * @param {number} width
 * @param {number} height
 * @param {number} pad
 * @returns {Array<[number, number]>}
 */
export function chartPoints(points, width, height, pad) {
  if (!points || points.length < 2 || !(width > 0) || !(height > 0)) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p[1] < min) min = p[1];
    if (p[1] > max) max = p[1];
  }
  const span = max - min;
  const inner = Math.max(0, height - 2 * pad);
  const last = points.length - 1;
  return points.map((p, i) => [
    (i / last) * width,
    span === 0 ? height / 2 : pad + inner * (1 - (p[1] - min) / span),
  ]);
}
