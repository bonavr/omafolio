// Display formatting for prices, money and changes. Pure ECMAScript: it also runs
// inside QML's JS engine, so numbers are formatted by hand rather than via Intl.

/** @typedef {import("./types.mjs").Quote} Quote */

/** @type {Record<string, string>} */
const DOLLAR_PREFIX = { USD: "US$", AUD: "A$", CAD: "C$", NZD: "NZ$", SGD: "S$", HKD: "HK$" };
/** @type {Record<string, string>} */
const SYMBOL_PREFIX = { EUR: "€", GBP: "£", JPY: "¥", CHF: "CHF", SEK: "kr", NOK: "kr", DKK: "kr", INR: "₹" };
const DASH = "—";

/** @param {string} digits Non-negative integer digits. */
function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats a non-negative number with the price precision rules (see formatPrice).
 * @param {number} abs
 * @param {string} ccy
 */
function formatMagnitude(abs, ccy) {
  let decimals;
  if (abs >= 1000) decimals = 0;
  else if (abs >= 1) decimals = ccy === "JPY" ? 0 : 2;
  else decimals = abs === 0 ? 2 : 3 - Math.floor(Math.log10(abs));
  const [whole, frac] = abs.toFixed(Math.min(decimals, 20)).split(".");
  return groupThousands(whole) + (frac ? "." + frac : "");
}

/**
 * Currency prefix for amounts in `ccy`, shown on a display whose base currency is `base`.
 * Dollar currencies are a bare "$" when they are the base and qualified ("US$", "A$") otherwise.
 * An unknown currency yields its code followed by a space.
 * @param {string} ccy
 * @param {string} base
 */
export function currencyPrefix(ccy, base) {
  if (ccy in DOLLAR_PREFIX) return ccy === base ? "$" : DOLLAR_PREFIX[ccy];
  if (ccy in SYMBOL_PREFIX) return SYMBOL_PREFIX[ccy];
  return ccy + " ";
}

/**
 * Rounds to whole units; `negative` is false when the result rounds to zero.
 * @param {number} amount
 */
function wholeUnits(amount) {
  const abs = Math.round(Math.abs(amount));
  return { abs, negative: amount < 0 && abs > 0 };
}

/**
 * A money amount in whole currency units with thousands separators, e.g. "-A$1,234".
 * Amounts that round to zero have no minus sign. Non-finite amounts render as a dash.
 * @param {number} amount
 * @param {string} ccy
 * @param {string} base
 */
export function formatMoney(amount, ccy, base) {
  if (!Number.isFinite(amount)) return DASH;
  const { abs, negative } = wholeUnits(amount);
  return (negative ? "-" : "") + currencyPrefix(ccy, base) + groupThousands(String(abs));
}

/**
 * A unit price: no decimals from 1000 up, 2 decimals from 1 up (0 for JPY),
 * and 4 significant digits below 1. Non-finite or negative prices render as a dash.
 * @param {number} price
 * @param {string} ccy
 * @param {string} base
 */
export function formatPrice(price, ccy, base) {
  if (!Number.isFinite(price) || price < 0) return DASH;
  return currencyPrefix(ccy, base) + formatMagnitude(price, ccy);
}

/**
 * Compact number for the bar, no currency. Shown in full (with "," separators)
 * when that is at most 7 characters, otherwise as k/M/B/T with up to 4 significant
 * digits and trailing zeros trimmed ("412.3k", "2.45M"). Non-finite input renders as a dash.
 * @param {number} n
 */
export function formatBarValue(n) {
  if (!Number.isFinite(n)) return DASH;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const full = sign + formatMagnitude(abs, "");
  if (full.length <= 7) return full;

  const units = ["k", "M", "B", "T"];
  let unit = 0;
  let scaled = abs / 1e3;
  // Rounding to 4 significant digits can reach 1000, which belongs in the next unit.
  while (unit < units.length - 1 && Number(scaled.toPrecision(4)) >= 1000) {
    scaled /= 1e3;
    unit++;
  }
  return sign + Number(scaled.toPrecision(4)) + units[unit];
}

/**
 * Percentage change as an arrow, a space and one decimal, e.g. "▲ 1.4%".
 * A change that rounds to 0.0 is flat ("— 0.0%"); null or non-finite input is a bare dash.
 * @param {number|null|undefined} pct
 */
export function formatChange(pct) {
  if (pct == null || !Number.isFinite(pct)) return DASH;
  const rounded = Math.round(Math.abs(pct) * 10) / 10;
  if (rounded === 0) return DASH + " 0.0%";
  return (pct > 0 ? "▲" : "▼") + " " + rounded.toFixed(1) + "%";
}

/**
 * Like formatMoney but with an explicit "+" for gains, e.g. "+$16,630".
 * Amounts that round to zero are unsigned ("$0").
 * @param {number} amount
 * @param {string} ccy
 * @param {string} base
 */
export function formatSigned(amount, ccy, base) {
  const text = formatMoney(amount, ccy, base);
  return Number.isFinite(amount) && amount > 0 && wholeUnits(amount).abs > 0 ? "+" + text : text;
}

/**
 * Short label for the bar: "₿" for bitcoin, the ticker symbol otherwise.
 * @param {Pick<Quote, "asset"|"symbol">} quote
 */
export function assetLabel(quote) {
  return quote.asset === "crypto:bitcoin" ? "₿" : quote.symbol;
}
