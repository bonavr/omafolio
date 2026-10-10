import { test } from "node:test";
import assert from "node:assert/strict";
import { barFrame } from "../lib/barframe.mjs";

const FRI_1600 = new Date(2026, 9, 9, 16, 0).getTime();
const FAIL_1402 = new Date(2026, 9, 9, 14, 2).getTime();
const q = (asset, symbol, price, previousClose, provider, extra) =>
  Object.assign({ asset, symbol, name: symbol, price, previousClose, currency: "USD", kind: "etf", asOf: FRI_1600, session: null, provider }, extra);
const healthy = { failures: 0, failingSince: null, lastSuccess: FRI_1600 };
const fresh = { failures: 0, failingSince: null, lastSuccess: null };
const quotes = {
  VOO: q("VOO", "VOO", 715.59, 711.28, "yahoo"),
  VTSAX: q("VTSAX", "VTSAX", 185.93, 185.93, "yahoo"),
  "crypto:bitcoin": q("crypto:bitcoin", "BTC", 118066, 116430, "coingecko"),
};
const view = (over) => Object.assign({
  total: 412300, dayChange: 3000, dayChangePct: 0.8, gain: 0, gainPct: 0, stale: [], excluded: [],
  positions: [{ asset: "VOO", value: 100, state: "closed" }, { asset: "VTSAX", value: 100, state: "closed" }],
}, over);
const data = (over) => Object.assign({
  quotes, states: { VOO: "live", VTSAX: "live", "crypto:bitcoin": "live" },
  portfolio: view(), providerHealth: { yahoo: healthy, coingecko: healthy },
}, over);

test("asset frame: label, value, change", () => {
  const f = barFrame("crypto:bitcoin", data());
  assert.deepEqual([f.label, f.value, f.change, f.state, f.warn, f.tooltip], ["₿", "118,066", "▲ 1.4%", "live", false, ""]);
  assert.equal(barFrame("VOO", data()).label, "VOO");
});

test("closed asset keeps its numbers and state", () => {
  const f = barFrame("VOO", data({ states: { VOO: "closed" } }));
  assert.deepEqual([f.value, f.state, f.warn], ["715.59", "closed", false]);
});

test("stale asset: warning and tooltip, with and without a failing provider", () => {
  const failing = { failures: 3, failingSince: FAIL_1402, lastSuccess: null };
  const f = barFrame("VOO", data({ states: { VOO: "stale" }, providerHealth: { yahoo: failing, coingecko: healthy } }));
  assert.equal(f.state, "stale");
  assert.equal(f.warn, true);
  assert.equal(f.tooltip, "Includes 1 stale price: VOO as of Fri 16:00 (Yahoo unavailable since 14:02)");
  const cached = barFrame("VOO", data({ states: { VOO: "stale" } }));
  assert.equal(cached.tooltip, "Includes 1 stale price: VOO as of Fri 16:00");
});

test("missing asset: dash and not-found tooltip; still loading shows no complaint", () => {
  const f = barFrame("VOOO", data({ states: { VOOO: "missing" } }));
  assert.deepEqual([f.label, f.value, f.change, f.state, f.tooltip], ["VOOO", "—", "", "missing", "VOOO not found, not included"]);
  const loading = barFrame("VOOO", data({ providerHealth: { yahoo: fresh, coingecko: healthy } }));
  assert.deepEqual([loading.value, loading.tooltip], ["…", ""]);
});

test("missing asset whose provider's first attempt failed: dash and the outage, not 'not found'", () => {
  const failed = { failures: 1, failingSince: FAIL_1402, lastSuccess: null };
  const f = barFrame("VOOO", data({ states: { VOOO: "missing" }, providerHealth: { yahoo: failed, coingecko: healthy } }));
  assert.deepEqual([f.value, f.tooltip], ["—", "Yahoo unavailable since 14:02"]);
  // The other provider's attempt state does not matter.
  const other = barFrame("VOOO", data({ states: { VOOO: "missing" }, providerHealth: { yahoo: healthy, coingecko: failed } }));
  assert.equal(other.tooltip, "VOOO not found, not included");
  const crypto = barFrame("crypto:nope", data({ states: { "crypto:nope": "missing" }, providerHealth: { yahoo: healthy, coingecko: fresh } }));
  assert.equal(crypto.value, "…");
});

test("direction follows the arrow; flat moves and missing prices are flat", () => {
  assert.equal(barFrame("crypto:bitcoin", data()).direction, "up");
  const down = barFrame("VOO", data({ quotes: { VOO: q("VOO", "VOO", 700, 711, "yahoo") }, states: { VOO: "live" } }));
  assert.deepEqual([down.direction, down.change], ["down", "▼ 1.5%"]);
  assert.equal(barFrame("VTSAX", data()).direction, "flat");
  assert.equal(barFrame("VOOO", data({ states: { VOOO: "missing" } })).direction, "flat");
  assert.equal(barFrame("portfolio", data()).direction, "up");
  assert.equal(barFrame("portfolio", data({ portfolio: view({ dayChangePct: -0.8 }) })).direction, "down");
  assert.equal(barFrame("portfolio", data({ portfolio: view({ dayChangePct: 0.04 }) })).direction, "flat");
});

test("portfolio excluded because its provider is down names the outage", () => {
  const failed = { failures: 2, failingSince: FAIL_1402, lastSuccess: null };
  const f = barFrame("portfolio", data({ portfolio: view({ excluded: ["VOOO"] }), states: { VOOO: "missing" }, providerHealth: { yahoo: failed, coingecko: healthy } }));
  assert.equal(f.tooltip, "Yahoo unavailable since 14:02");
});

test("a zero previous close gives no change figure", () => {
  const f = barFrame("VOO", data({ quotes: { VOO: q("VOO", "VOO", 10, 0, "yahoo") }, states: { VOO: "live" } }));
  assert.equal(f.change, "—");
});

test("portfolio: closed only when every valued position is closed", () => {
  assert.equal(barFrame("portfolio", data()).state, "closed");
  const mixed = view({ positions: [{ asset: "VOO", value: 1, state: "closed" }, { asset: "crypto:bitcoin", value: 1, state: "live" }] });
  assert.equal(barFrame("portfolio", data({ portfolio: mixed })).state, "live");
  const excludedOnly = view({ positions: [{ asset: "VOO", value: 1, state: "closed" }, { asset: "X", value: null, state: "missing" }] });
  assert.equal(barFrame("portfolio", data({ portfolio: excludedOnly })).state, "closed");
});

test("portfolio: value, change, glyph", () => {
  const f = barFrame("portfolio", data());
  assert.deepEqual([f.label, f.value, f.change], ["󰄨", "412,300", "▲ 0.8%"]);
});

test("portfolio: stale prices pluralise and list assets", () => {
  const one = barFrame("portfolio", data({ portfolio: view({ stale: ["VOO"] }), states: { VOO: "stale" } }));
  assert.equal(one.warn, true);
  assert.match(one.tooltip, /^Includes 1 stale price: VOO as of Fri 16:00$/);
  const two = barFrame("portfolio", data({ portfolio: view({ stale: ["VOO", "VTSAX"] }) }));
  assert.match(two.tooltip, /^Includes 2 stale prices: VOO as of Fri 16:00, VTSAX as of Fri 16:00$/);
  assert.equal(barFrame("portfolio", data()).warn, false);
});

test("portfolio: excluded assets are named", () => {
  const f = barFrame("portfolio", data({ portfolio: view({ excluded: ["VOOO", "crypto:nope"] }), states: { VOOO: "missing", "crypto:nope": "missing" } }));
  assert.equal(f.warn, true);
  assert.equal(f.tooltip, "VOOO, nope not found, not included");
  const rate = barFrame("portfolio", data({ portfolio: view({ excluded: ["VOO"] }), states: { VOO: "live" } }));
  assert.equal(rate.tooltip, "VOO has no exchange rate, not included");
});

test("portfolio with nothing valued: dash once every provider has been tried, ellipsis before", () => {
  const empty = view({ total: 0, dayChangePct: null, positions: [{ asset: "VOO", value: null, state: "missing" }] });
  assert.equal(barFrame("portfolio", data({ portfolio: empty })).value, "—");
  assert.equal(barFrame("portfolio", data({ portfolio: empty, providerHealth: { yahoo: fresh, coingecko: healthy } })).value, "…");
  assert.equal(barFrame("portfolio", data({ portfolio: view({ positions: [] }), providerHealth: { yahoo: fresh, coingecko: fresh } })).value, "—");
});
