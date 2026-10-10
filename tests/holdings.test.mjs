import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHoldings, serializeHoldings, withHolding, withoutHolding, defaultCostCurrency, jsonErrorLine,
} from "../lib/holdings.mjs";

const SPEC_EXAMPLE = `{ "holdings": [
  { "asset": "VOO",            "quantity": 12,     "cost": 410.25 },
  { "asset": "VTSAX",          "quantity": 30.512, "cost": 98.10 },
  { "asset": "crypto:bitcoin", "quantity": 0.05,   "cost": 61000, "costCurrency": "AUD" }
]}`;

const one = (extra = {}) => JSON.stringify({ holdings: [{ asset: "VOO", quantity: 1, cost: 1, ...extra }] });

test("null or empty text is an empty portfolio", () => {
  assert.deepEqual(parseHoldings(null), { ok: true, holdings: [] });
  assert.deepEqual(parseHoldings(""), { ok: true, holdings: [] });
  assert.deepEqual(parseHoldings("  \n"), { ok: true, holdings: [] });
});

test("reads the documented format", () => {
  const r = parseHoldings(SPEC_EXAMPLE);
  assert.equal(r.holdings.length, 3);
  assert.equal(r.holdings[2].costCurrency, "AUD");
  assert.equal(r.holdings[0].costCurrency, undefined);
  assert.deepEqual(r.holdings[1], { asset: "VTSAX", quantity: 30.512, cost: 98.1 });
});

test("bad JSON reports the line", () => {
  const r = parseHoldings('{\n "holdings": [\n  { "asset": "VOO", }\n]}');
  assert.equal(r.ok, false);
  assert.equal(r.line, 3);
  assert.equal(typeof r.error, "string");
});

test("jsonErrorLine prefers 'line N' in the message", () => {
  assert.equal(jsonErrorLine("Expected x in JSON at position 41 (line 3 column 20)", "a\nb\nc"), 3);
  assert.equal(jsonErrorLine("Unexpected token at line 7", ""), 7);
});

test("jsonErrorLine falls back to counting newlines before 'position N'", () => {
  const text = "ab\ncd\nef";
  assert.equal(jsonErrorLine("Unexpected token in JSON at position 0", text), 1);
  assert.equal(jsonErrorLine("Unexpected token in JSON at position 2", text), 1); // the newline itself is on line 1
  assert.equal(jsonErrorLine("Unexpected token in JSON at position 3", text), 2);
  assert.equal(jsonErrorLine("Unexpected token in JSON at position 6", text), 3);
});

test("jsonErrorLine is null when the message has no location", () => {
  assert.equal(jsonErrorLine("Parse error", "a\nb"), null);
});

test("top level must be an object with a holdings array", () => {
  for (const text of ["null", "[]", "5", '"x"', "{}", '{"holdings":{}}', '{"holdings":"x"}']) {
    const r = parseHoldings(text);
    assert.equal(r.ok, false, text);
    assert.equal(r.line, null);
  }
  assert.deepEqual(parseHoldings('{"holdings":[]}'), { ok: true, holdings: [] });
});

test("entries with a missing asset or non-numeric quantity are an error, not dropped", () => {
  const r = parseHoldings('{"holdings":[{"asset":"VOO","quantity":"x","cost":1}]}');
  assert.equal(r.ok, false);
  assert.equal(r.line, null);
  const bad = parseHoldings('{"holdings":[{"asset":"VOO","quantity":1,"cost":1},{"quantity":1,"cost":1}]}');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /entry 2/);
});

test("asset must be a non-empty string", () => {
  assert.equal(parseHoldings(one({ asset: "" })).ok, false);
  assert.equal(parseHoldings(one({ asset: 5 })).ok, false);
  assert.equal(parseHoldings(one({ asset: "V" })).ok, true);
});

test("quantity boundary: 0 accepted, -0.0001 rejected", () => {
  assert.equal(parseHoldings(one({ quantity: 0 })).ok, true);
  assert.equal(parseHoldings(one({ quantity: 0.0001 })).ok, true);
  assert.equal(parseHoldings(one({ quantity: -0.0001 })).ok, false);
});

test("cost boundary: 0 accepted, -0.0001 rejected", () => {
  assert.equal(parseHoldings(one({ cost: 0 })).ok, true);
  assert.equal(parseHoldings(one({ cost: -0.0001 })).ok, false);
});

test("non-finite and non-number quantity or cost are rejected", () => {
  assert.equal(parseHoldings('{"holdings":[{"asset":"VOO","quantity":1e999,"cost":1}]}').ok, false);
  assert.equal(parseHoldings('{"holdings":[{"asset":"VOO","quantity":1,"cost":1e999}]}').ok, false);
  assert.equal(parseHoldings(one({ cost: null })).ok, false);
  assert.equal(parseHoldings(one({ quantity: true })).ok, false);
  assert.equal(parseHoldings('{"holdings":[{"asset":"VOO","quantity":1}]}').ok, false);
});

test("costCurrency, when present, is a non-empty string stored upper-case", () => {
  assert.equal(parseHoldings(one({ costCurrency: "" })).ok, false);
  assert.equal(parseHoldings(one({ costCurrency: 5 })).ok, false);
  assert.equal(parseHoldings(one({ costCurrency: null })).ok, false);
  assert.equal(parseHoldings(one({ costCurrency: "a" })).holdings[0].costCurrency, "A");
  assert.equal(parseHoldings(one({ costCurrency: "aud" })).holdings[0].costCurrency, "AUD");
});

test("duplicates with the same cost currency merge with weighted cost", () => {
  const r = parseHoldings('{"holdings":[{"asset":"VOO","quantity":10,"cost":400},{"asset":"VOO","quantity":10,"cost":420}]}');
  assert.deepEqual(r.holdings, [{ asset: "VOO", quantity: 20, cost: 410 }]);
});

test("merge weights by quantity and keeps first-seen position", () => {
  const r = parseHoldings(JSON.stringify({ holdings: [
    { asset: "A", quantity: 1, cost: 1 },
    { asset: "B", quantity: 1, cost: 1 },
    { asset: "A", quantity: 3, cost: 5 },
  ] }));
  assert.deepEqual(r.holdings, [{ asset: "A", quantity: 4, cost: 4 }, { asset: "B", quantity: 1, cost: 1 }]);
});

test("merging zero-quantity duplicates keeps the first cost and quantity 0", () => {
  const r = parseHoldings(JSON.stringify({ holdings: [
    { asset: "A", quantity: 0, cost: 7 },
    { asset: "A", quantity: 0, cost: 9 },
  ] }));
  assert.deepEqual(r.holdings, [{ asset: "A", quantity: 0, cost: 7 }]);
});

test("duplicates differing only in costCurrency case merge", () => {
  const r = parseHoldings(JSON.stringify({ holdings: [
    { asset: "X", quantity: 1, cost: 1, costCurrency: "aud" },
    { asset: "X", quantity: 1, cost: 3, costCurrency: "AUD" },
  ] }));
  assert.deepEqual(r.holdings, [{ asset: "X", quantity: 2, cost: 2, costCurrency: "AUD" }]);
});

test("duplicates with different cost currencies stay separate", () => {
  const r = parseHoldings('{"holdings":[{"asset":"crypto:bitcoin","quantity":1,"cost":1,"costCurrency":"AUD"},{"asset":"crypto:bitcoin","quantity":1,"cost":1,"costCurrency":"USD"}]}');
  assert.equal(r.holdings.length, 2);
});

test("a set cost currency and an unset one stay separate", () => {
  const r = parseHoldings(JSON.stringify({ holdings: [
    { asset: "X", quantity: 1, cost: 1 },
    { asset: "X", quantity: 1, cost: 1, costCurrency: "USD" },
  ] }));
  assert.equal(r.holdings.length, 2);
});

const holdings = [
  { asset: "VOO", quantity: 12, cost: 410.25 },
  { asset: "crypto:bitcoin", quantity: 0.05, cost: 61000, costCurrency: "AUD" },
];

test("round trip, one holding per line, costCurrency only when set", () => {
  const text = serializeHoldings(holdings);
  assert.deepEqual(parseHoldings(text).holdings, holdings);
  assert.equal(text.split("\n").filter(l => l.includes('"asset"')).length, holdings.length);
  assert.ok(!text.includes('"costCurrency": undefined'));
  assert.equal(text.split("\n").filter(l => l.includes("costCurrency")).length, 1);
});

test("serialised layout matches the documented shape exactly", () => {
  assert.equal(serializeHoldings(holdings), [
    '{ "holdings": [',
    '  { "asset": "VOO", "quantity": 12, "cost": 410.25 },',
    '  { "asset": "crypto:bitcoin", "quantity": 0.05, "cost": 61000, "costCurrency": "AUD" }',
    ']}',
    '',
  ].join("\n"));
});

test("an empty list serialises to a two-line object that parses back empty", () => {
  const text = serializeHoldings([]);
  assert.equal(text, '{ "holdings": [\n]}\n');
  assert.deepEqual(parseHoldings(text), { ok: true, holdings: [] });
});

test("the spec example round-trips", () => {
  const first = parseHoldings(SPEC_EXAMPLE).holdings;
  assert.deepEqual(parseHoldings(serializeHoldings(first)).holdings, first);
});

test("asset strings with quotes survive serialisation", () => {
  const h = [{ asset: 'A"B', quantity: 1, cost: 1 }];
  assert.deepEqual(parseHoldings(serializeHoldings(h)).holdings, h);
});

test("withHolding appends a new asset and replaces the same (asset, costCurrency)", () => {
  const base = [{ asset: "A", quantity: 1, cost: 1 }, { asset: "B", quantity: 2, cost: 2 }];
  const added = withHolding(base, { asset: "C", quantity: 3, cost: 3 });
  assert.deepEqual(added.map(h => h.asset), ["A", "B", "C"]);
  const replaced = withHolding(base, { asset: "A", quantity: 9, cost: 9 });
  assert.deepEqual(replaced, [{ asset: "A", quantity: 9, cost: 9 }, base[1]]);
});

test("withHolding treats a different costCurrency as a different entry", () => {
  const base = [{ asset: "A", quantity: 1, cost: 1, costCurrency: "AUD" }];
  assert.equal(withHolding(base, { asset: "A", quantity: 1, cost: 1, costCurrency: "USD" }).length, 2);
  assert.equal(withHolding(base, { asset: "A", quantity: 1, cost: 1 }).length, 2);
  assert.equal(withHolding(base, { asset: "A", quantity: 5, cost: 1, costCurrency: "AUD" }).length, 1);
  const unset = [{ asset: "A", quantity: 1, cost: 1 }];
  assert.equal(withHolding(unset, { asset: "A", quantity: 5, cost: 1 }).length, 1);
});

test("withoutHolding removes only the matching (asset, costCurrency)", () => {
  const base = [
    { asset: "A", quantity: 1, cost: 1 },
    { asset: "A", quantity: 1, cost: 1, costCurrency: "AUD" },
    { asset: "B", quantity: 1, cost: 1 },
  ];
  assert.deepEqual(withoutHolding(base, "A", undefined).map(h => h.costCurrency), ["AUD", undefined]);
  assert.deepEqual(withoutHolding(base, "A", "AUD").map(h => h.asset), ["A", "B"]);
  assert.equal(withoutHolding(base, "A", "USD").length, 3);
  assert.equal(withoutHolding(base, "Z").length, 3);
});

test("withHolding and withoutHolding do not mutate their input", () => {
  const base = [{ asset: "A", quantity: 1, cost: 1 }];
  const snapshot = JSON.stringify(base);
  withHolding(base, { asset: "A", quantity: 2, cost: 2 });
  withHolding(base, { asset: "B", quantity: 2, cost: 2 });
  withoutHolding(base, "A");
  assert.equal(JSON.stringify(base), snapshot);
});

test("crypto cost defaults to base; stocks to listing currency", () => {
  assert.equal(defaultCostCurrency("crypto:bitcoin", "AUD"), "AUD");
  assert.equal(defaultCostCurrency("VOO", "AUD"), undefined);
  assert.equal(defaultCostCurrency("crypto", "AUD"), undefined);
});
