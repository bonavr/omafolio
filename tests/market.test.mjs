import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assetsToFetch, fxPairs, priceState, nextDelayMs, mergeQuotes, notFound,
  recordSuccess, recordFailure, canFetchNow, STALE_AFTER_MS, CLOSED_POLL_MS, MAX_BACKOFF_MS,
} from "../lib/market.mjs";

const T0 = 1_700_000_000_000;
const H = 3_600_000;
const open = { start: T0, end: T0 + 6.5 * H, timezone: "America/New_York" };
const healthy = { failures: 0, failingSince: null, lastSuccess: T0 };
const failingSince = (t) => ({ failures: 1, failingSince: t, lastSuccess: null });
const q = (asset, currency, kind = "stock", session = null) => ({
  asset, symbol: asset, name: asset, price: 1, previousClose: 1, currency, kind, asOf: T0, session,
  provider: asset.startsWith("crypto:") ? "coingecko" : "yahoo",
});

test("constants", () => {
  assert.equal(STALE_AFTER_MS, 180000);
  assert.equal(CLOSED_POLL_MS, 900000);
  assert.equal(MAX_BACKOFF_MS, 900000);
});

test("bar items are fetched even when not held or watched", () => {
  assert.deepEqual(assetsToFetch({ bar: ["portfolio", "crypto:bitcoin"], watch: [] }, []), ["crypto:bitcoin"]);
});
test("assetsToFetch orders holdings, watch, bar and de-duplicates", () => {
  const holdings = [{ asset: "VOO", quantity: 1, cost: 1 }, { asset: "AAPL", quantity: 1, cost: 1 }];
  assert.deepEqual(
    assetsToFetch({ bar: ["portfolio", "MSFT", "VOO"], watch: ["MSFT", "AAPL", "TSLA"] }, holdings),
    ["VOO", "AAPL", "MSFT", "TSLA"],
  );
});

test("no FX pair for base-currency assets or crypto", () => {
  const quotes = { VOO: q("VOO", "USD"), "crypto:bitcoin": q("crypto:bitcoin", "USD", "crypto") };
  assert.deepEqual(fxPairs(quotes, [], "USD"), []);
  assert.deepEqual(fxPairs(quotes, [], "AUD"), ["USDAUD=X"]);
});
test("crypto and fx quotes in foreign currencies add no pair", () => {
  const quotes = { "crypto:bitcoin": q("crypto:bitcoin", "EUR", "crypto"), "USDEUR=X": q("USDEUR=X", "EUR", "fx") };
  assert.deepEqual(fxPairs(quotes, [], "AUD"), []);
});
test("cost currencies need FX too", () => {
  assert.deepEqual(fxPairs({}, [{ asset: "crypto:bitcoin", quantity: 1, cost: 1, costCurrency: "EUR" }], "AUD"), ["EURAUD=X"]);
  assert.deepEqual(fxPairs({}, [{ asset: "VOO", quantity: 1, cost: 1, costCurrency: "AUD" }], "AUD"), []);
  assert.deepEqual(fxPairs({}, [{ asset: "VOO", quantity: 1, cost: 1 }], "AUD"), []);
});
test("fxPairs de-duplicates and sorts", () => {
  const quotes = { A: q("A", "USD"), B: q("B", "USD"), C: q("C", "EUR") };
  const holdings = [{ asset: "A", quantity: 1, cost: 1, costCurrency: "GBP" }, { asset: "B", quantity: 1, cost: 1, costCurrency: "EUR" }];
  assert.deepEqual(fxPairs(quotes, holdings, "AUD"), ["EURAUD=X", "GBPAUD=X", "USDAUD=X"]);
});

test("states", () => {
  assert.equal(priceState(undefined, healthy, T0), "missing");
  assert.equal(priceState(q("VOO", "USD", "etf", open), healthy, T0 + H), "live");
  assert.equal(priceState(q("VOO", "USD", "etf", open), healthy, T0 + 8 * H), "closed");
  assert.equal(priceState(q("VOO", "USD", "etf", open), failingSince(T0 + H), T0 + H + 181000), "stale");
  assert.equal(priceState(q("VOO", "USD", "etf", open), failingSince(T0 + H), T0 + H + 179000), "live");
  assert.equal(priceState(q("VOO", "USD", "etf", open), failingSince(T0), T0 + 8 * H), "closed");
  assert.equal(priceState({ ...q("crypto:bitcoin", "AUD", "crypto"), fromCache: true }, healthy, T0), "stale");
  assert.equal(priceState({ ...q("VOO", "USD", "etf", open), fromCache: true }, healthy, T0 + 8 * H), "closed");
});
test("stale boundary: exactly 3 minutes is live", () => {
  const quote = q("VOO", "USD", "etf", open);
  const h = failingSince(T0 + H);
  assert.equal(priceState(quote, h, T0 + H + 180000), "live");
  assert.equal(priceState(quote, h, T0 + H + 180001), "stale");
});
test("session boundaries", () => {
  const quote = q("VOO", "USD", "etf", open);
  assert.equal(priceState(quote, healthy, open.start - 1), "closed");
  assert.equal(priceState(quote, healthy, open.start), "live");
  assert.equal(priceState(quote, healthy, open.end - 1), "live");
  assert.equal(priceState(quote, healthy, open.end), "closed");
});
test("undefined health counts as healthy; fromCache with open session is stale", () => {
  assert.equal(priceState(q("VOO", "USD", "etf", open), undefined, T0 + H), "live");
  assert.equal(priceState({ ...q("VOO", "USD", "etf", open), fromCache: true }, undefined, T0 + H), "stale");
});

test("schedule", () => {
  assert.equal(nextDelayMs("coingecko", {}, healthy, 60, T0), 60000);
  assert.equal(nextDelayMs("yahoo", { VOO: q("VOO", "USD", "etf", open) }, healthy, 60, T0 + H), 60000);
  assert.equal(nextDelayMs("yahoo", { VOO: q("VOO", "USD", "etf", open) }, healthy, 60, T0 + 8 * H), 900000);
  assert.equal(nextDelayMs("yahoo", {}, healthy, 120, T0), 120000);
});
test("schedule: yahoo open if any yahoo quote is open; other providers' quotes ignored", () => {
  const closed = q("AAPL", "USD", "stock", { ...open, end: T0 + H });
  const quotes = { AAPL: closed, VOO: q("VOO", "USD", "etf", open) };
  assert.equal(nextDelayMs("yahoo", quotes, healthy, 60, T0 + 2 * H), 60000);
  assert.equal(nextDelayMs("yahoo", { AAPL: closed }, healthy, 60, T0 + 2 * H), 900000);
  assert.equal(nextDelayMs("yahoo", { AAPL: closed, "crypto:bitcoin": q("crypto:bitcoin", "USD", "crypto") }, healthy, 60, T0 + 2 * H), 900000);
});
test("backoff doubles from 60s and caps at 15 minutes", () => {
  const delays = [1, 2, 3, 4, 5, 6].map((n) => nextDelayMs("yahoo", {}, { failures: n, failingSince: T0, lastSuccess: null }, 60, T0));
  assert.deepEqual(delays, [60000, 120000, 240000, 480000, 900000, 900000]);
});
test("backoff boundary: 0 vs 1 failures, and applies when market closed", () => {
  const closedQuotes = { VOO: q("VOO", "USD", "etf", open) };
  assert.equal(nextDelayMs("yahoo", {}, { failures: 0, failingSince: null, lastSuccess: null }, 300, T0), 300000);
  assert.equal(nextDelayMs("yahoo", {}, { failures: 1, failingSince: T0, lastSuccess: null }, 300, T0), 60000);
  assert.equal(nextDelayMs("yahoo", closedQuotes, { failures: 2, failingSince: T0, lastSuccess: null }, 60, T0 + 8 * H), 120000);
  assert.equal(nextDelayMs("yahoo", {}, undefined, 60, T0), 60000);
});

test("last good quote survives and fresh replaces", () => {
  const m = mergeQuotes({ VOO: q("VOO", "USD"), AAPL: q("AAPL", "USD") }, [{ ...q("VOO", "USD"), price: 2 }]);
  assert.equal(m.VOO.price, 2);
  assert.ok(m.AAPL);
  assert.equal(m.VOO.fromCache, undefined);
});
test("mergeQuotes does not mutate previous and drops fromCache of replaced quote", () => {
  const previous = { VOO: { ...q("VOO", "USD"), fromCache: true } };
  const m = mergeQuotes(previous, [{ ...q("VOO", "USD"), price: 3 }]);
  assert.notEqual(m, previous);
  assert.equal(previous.VOO.price, 1);
  assert.equal(previous.VOO.fromCache, true);
  assert.equal("fromCache" in m.VOO, false);
});

test("notFound is requested minus returned", () => assert.deepEqual(notFound(["VOO", "VOOO"], [q("VOO", "USD")]), ["VOOO"]));

test("health transitions", () => {
  const start = { failures: 0, failingSince: null, lastSuccess: 5 };
  const f1 = recordFailure(start, 100);
  assert.deepEqual(f1, { failures: 1, failingSince: 100, lastSuccess: 5 });
  assert.deepEqual(recordFailure(f1, 200), { failures: 2, failingSince: 100, lastSuccess: 5 });
  assert.deepEqual(recordSuccess(f1, 300), { failures: 0, failingSince: null, lastSuccess: 300 });
  assert.deepEqual(start, { failures: 0, failingSince: null, lastSuccess: 5 });
  assert.deepEqual(recordFailure(undefined, 7), { failures: 1, failingSince: 7, lastSuccess: null });
  assert.deepEqual(recordSuccess(undefined, 7), { failures: 0, failingSince: null, lastSuccess: 7 });
});

test("manual refresh inside the window is refused", () => {
  assert.equal(canFetchNow(T0, 60, T0 + 59000), false);
  assert.equal(canFetchNow(T0, 60, T0 + 59999), false);
  assert.equal(canFetchNow(T0, 60, T0 + 60000), true);
  assert.equal(canFetchNow(null, 60, T0), true);
});
