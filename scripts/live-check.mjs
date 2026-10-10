// Calls the real Yahoo Finance and CoinGecko endpoints through the same request builders and
// parsers the plugin uses, and reports per endpoint "ok" or the error. Exits 1 if any fail.
// Run by hand (`node scripts/live-check.mjs`); never in CI, because it needs the network and
// the free endpoints are rate limited. Requests mirror Fetcher.qml: user agent Mozilla/5.0,
// no cookies, 15 second timeout.

import { quoteRequests, historyRequests, searchRequests, parse } from "../lib/providers/index.mjs";

const COINGECKO_SPACING_MS = 2500;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetches `request` and parses it. Resolves to a short description of the result; throws if the
 * request fails, parses to nothing, or the parser rejects the body.
 * @param {import("../lib/types.mjs").Request} request
 * @param {(parsed: any[]) => string|null} expect Returns an error message, or null when the parsed result is as wanted.
 */
async function run(request, expect) {
  const response = await fetch(request.url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(15000),
  });
  const parsed = parse(request, response.status, await response.text());
  const problem = expect(parsed);
  if (problem) throw new Error(problem);
  return `${parsed.length} result(s)`;
}

/** Fails unless every wanted asset appears in the parsed quotes or series. */
const covers = (/** @type {string[]} */ wanted) => (/** @type {any[]} */ parsed) => {
  const have = new Set(parsed.map((p) => p.asset));
  const missing = wanted.filter((w) => !have.has(w));
  return missing.length ? `no result for ${missing.join(", ")}` : null;
};
const nonEmpty = (/** @type {any[]} */ parsed) => (parsed.length ? null : "empty result");

const stock = "AAPL", etf = "VOO", fund = "VTSAX", fx = "USDAUD=X", btc = "crypto:bitcoin";
const yahooAssets = [stock, etf, fund, fx];
const kindOf = () => undefined;

/** @type {Array<{name: string, provider: string, request: import("../lib/types.mjs").Request, expect: (p: any[]) => string|null}>} */
const checks = [];
const only = (/** @type {import("../lib/types.mjs").Request[]} */ reqs, /** @type {string} */ provider) => {
  const found = reqs.filter((r) => r.provider === provider);
  if (found.length !== 1) throw new Error(`expected one ${provider} request, got ${found.length}`);
  return found[0];
};

checks.push({ name: "Yahoo quotes (stock, ETF, fund, FX)", provider: "yahoo",
  request: only(quoteRequests(yahooAssets), "yahoo"), expect: covers(yahooAssets) });
checks.push({ name: "Yahoo history 1M (stock, ETF, fund, FX)", provider: "yahoo",
  request: only(historyRequests(yahooAssets, "1M", kindOf), "yahoo"), expect: covers(yahooAssets) });
checks.push({ name: "Yahoo search", provider: "yahoo",
  request: only(searchRequests("vanguard total"), "yahoo"), expect: nonEmpty });
checks.push({ name: "CoinGecko quotes", provider: "coingecko",
  request: only(quoteRequests([btc]), "coingecko"), expect: covers([btc]) });
checks.push({ name: "CoinGecko history 1M", provider: "coingecko",
  request: only(historyRequests([btc], "1M", kindOf), "coingecko"), expect: covers([btc]) });
checks.push({ name: "CoinGecko search", provider: "coingecko",
  request: only(searchRequests("sol"), "coingecko"), expect: nonEmpty });

let failures = 0;
let lastCoinGecko = 0;
for (const c of checks) {
  if (c.provider === "coingecko") {
    const wait = lastCoinGecko + COINGECKO_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
  }
  try {
    console.log(`ok    ${c.name}: ${await run(c.request, c.expect)}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${c.name}: ${e instanceof Error ? e.message : e}`);
  }
  if (c.provider === "coingecko") lastCoinGecko = Date.now();
}
process.exit(failures ? 1 : 0);
