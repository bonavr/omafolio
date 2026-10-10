import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuoteCache, serializeQuoteCache } from "../lib/quotecache.mjs";

/** @returns {import("../lib/types.mjs").Quote} */
const voo = () => ({
  asset: "VOO", symbol: "VOO", name: "Vanguard S&P 500 ETF", price: 715.59, previousClose: 712.1,
  currency: "USD", kind: "etf", asOf: 1791576000000,
  session: { start: 1791552600000, end: 1791576000000, timezone: "America/New_York" }, provider: "yahoo",
});
/** @returns {import("../lib/types.mjs").Quote} */
const btc = () => ({
  asset: "crypto:bitcoin", symbol: "BTC", name: "Bitcoin", price: 118243, previousClose: 117000,
  currency: "AUD", kind: "crypto", asOf: 1791600000000, session: null, provider: "coingecko",
});

const cacheWith = (/** @type {Record<string, unknown>} */ quotes) => JSON.stringify({ quotes });

test("valid entries are returned marked fromCache", () => {
  const got = parseQuoteCache(cacheWith({ VOO: voo(), "crypto:bitcoin": btc() }));
  assert.deepEqual(got, { VOO: { ...voo(), fromCache: true }, "crypto:bitcoin": { ...btc(), fromCache: true } });
});

test("missing, empty or malformed JSON gives no quotes", () => {
  for (const text of [null, "", "   ", "{", "not json", '{"quotes": [1]}', "[]", "null", "5", "{}", '{"quotes": null}', '{"quotes": "x"}']) {
    assert.deepEqual(parseQuoteCache(text), {}, String(text));
  }
});

test("entries missing a field, or with a field of the wrong type, are skipped; the rest survive", () => {
  const fields = ["asset", "symbol", "name", "price", "previousClose", "currency", "kind", "asOf", "session", "provider"];
  for (const field of fields) {
    const broken = /** @type {Record<string, unknown>} */ (voo());
    delete broken[field];
    assert.deepEqual(Object.keys(parseQuoteCache(cacheWith({ VOO: broken, "crypto:bitcoin": btc() }))), ["crypto:bitcoin"], `without ${field}`);
    const wrong = /** @type {Record<string, unknown>} */ (voo());
    wrong[field] = field === "session" ? "open" : (typeof wrong[field] === "number" ? "1" : 1);
    assert.deepEqual(Object.keys(parseQuoteCache(cacheWith({ VOO: wrong }))), [], `${field} of the wrong type`);
  }
  for (const entry of [null, 5, "x", [voo()]]) {
    assert.deepEqual(parseQuoteCache(cacheWith({ VOO: entry })), {}, JSON.stringify(entry));
  }
});

test("non-finite numbers are skipped", () => {
  // 1e999 parses to Infinity; JSON has no NaN, but a hand-edited null must not pass either.
  for (const field of ["price", "previousClose", "asOf"]) {
    const text = cacheWith({ VOO: voo() }).replace(`"${field}":${JSON.stringify(/** @type {any} */ (voo())[field])}`, `"${field}":1e999`);
    assert.notEqual(text, cacheWith({ VOO: voo() }), field);
    assert.deepEqual(parseQuoteCache(text), {}, `${field} Infinity`);
    const withNull = /** @type {Record<string, unknown>} */ (voo());
    withNull[field] = null;
    assert.deepEqual(parseQuoteCache(cacheWith({ VOO: withNull })), {}, `${field} null`);
  }
  for (const session of [{ start: null, end: 1, timezone: "UTC" }, { start: 1, end: "2", timezone: "UTC" }, { start: 1, end: 2 }]) {
    assert.deepEqual(parseQuoteCache(cacheWith({ VOO: { ...voo(), session } })), {}, JSON.stringify(session));
  }
});

test("an entry filed under another asset, of an unknown kind, or from the wrong provider is skipped", () => {
  assert.deepEqual(parseQuoteCache(cacheWith({ VTI: voo() })), {});
  assert.deepEqual(parseQuoteCache(cacheWith({ VOO: { ...voo(), kind: "bond" } })), {});
  assert.deepEqual(parseQuoteCache(cacheWith({ VOO: { ...voo(), provider: "coingecko" } })), {});
  assert.deepEqual(parseQuoteCache(cacheWith({ "crypto:bitcoin": { ...btc(), provider: "yahoo" } })), {});
  // A "__proto__" key in the file must not become the result's prototype.
  const proto = JSON.stringify({ ...voo(), asset: "__proto__", symbol: "__proto__" });
  const got = parseQuoteCache(`{"quotes": {"__proto__": ${proto}}}`);
  assert.equal(Object.getPrototypeOf(got), Object.prototype);
  assert.deepEqual(Object.keys(got), []);
});

test("serialise then parse round-trips, dropping fromCache on the way out", () => {
  const quotes = { VOO: { ...voo(), fromCache: true }, "crypto:bitcoin": btc() };
  const text = serializeQuoteCache(quotes);
  assert.equal(text.includes("fromCache"), false);
  assert.deepEqual(parseQuoteCache(text), { VOO: { ...voo(), fromCache: true }, "crypto:bitcoin": { ...btc(), fromCache: true } });
  assert.deepEqual(quotes.VOO.fromCache, true, "input not mutated");
  assert.equal(serializeQuoteCache({}), '{"quotes":{}}');
});

test("serialising the same quotes gives the same text, so unchanged caches are not rewritten", () => {
  assert.equal(serializeQuoteCache({ VOO: voo() }), serializeQuoteCache({ VOO: { ...voo(), fromCache: true } }));
});

test("a day range survives the round trip; a malformed one makes the entry invalid", () => {
  const ranged = { ...voo(), dayRange: { low: 712.54, high: 716.43 } };
  assert.deepEqual(parseQuoteCache(serializeQuoteCache({ VOO: ranged })).VOO.dayRange, ranged.dayRange);
  assert.deepEqual(Object.keys(parseQuoteCache(cacheWith({ VOO: { ...voo(), dayRange: { low: 5, high: 5 } } }))), ["VOO"]);
  for (const dayRange of [null, "1-2", [1, 2], { low: 5.01, high: 5 }, { low: 1 }, { low: "1", high: 2 }]) {
    assert.deepEqual(parseQuoteCache(cacheWith({ VOO: { ...voo(), dayRange } })), {}, JSON.stringify(dayRange));
  }
});

test("a session's UTC offset is optional but must be a number", () => {
  const withOffset = { ...voo(), session: { ...voo().session, utcOffsetSeconds: -14400 } };
  assert.deepEqual(parseQuoteCache(serializeQuoteCache({ VOO: withOffset })).VOO.session, withOffset.session);
  for (const utcOffsetSeconds of ["-14400", null]) {
    assert.deepEqual(parseQuoteCache(cacheWith({ VOO: { ...voo(), session: { ...voo().session, utcOffsetSeconds } } })), {}, String(utcOffsetSeconds));
  }
});
