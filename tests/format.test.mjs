import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currencyPrefix,
  formatMoney,
  formatPrice,
  formatBarValue,
  formatChange,
  formatSigned,
  assetLabel,
} from "../lib/format.mjs";

test("prefix is plain when currency is the base, explicit otherwise", () => {
  assert.equal(currencyPrefix("AUD", "AUD"), "$");
  assert.equal(currencyPrefix("USD", "AUD"), "US$");
  assert.equal(currencyPrefix("AUD", "USD"), "A$");
  assert.equal(currencyPrefix("EUR", "EUR"), "€");
});

test("prefix covers every dollar and symbol currency", () => {
  assert.equal(currencyPrefix("CAD", "USD"), "C$");
  assert.equal(currencyPrefix("NZD", "USD"), "NZ$");
  assert.equal(currencyPrefix("SGD", "USD"), "S$");
  assert.equal(currencyPrefix("HKD", "USD"), "HK$");
  assert.equal(currencyPrefix("NZD", "NZD"), "$");
  assert.equal(currencyPrefix("GBP", "USD"), "£");
  assert.equal(currencyPrefix("JPY", "USD"), "¥");
  assert.equal(currencyPrefix("CHF", "USD"), "CHF");
  assert.equal(currencyPrefix("SEK", "USD"), "kr");
  assert.equal(currencyPrefix("NOK", "USD"), "kr");
  assert.equal(currencyPrefix("DKK", "USD"), "kr");
  assert.equal(currencyPrefix("INR", "USD"), "₹");
  assert.equal(currencyPrefix("EUR", "USD"), "€");
});

test("prefix for an unknown currency is its code with a space", () => {
  assert.equal(currencyPrefix("XYZ", "USD"), "XYZ ");
});

test("prices: 0 decimals from 1000, 2 from 1, 4 significant below 1", () => {
  assert.equal(formatPrice(118066.4, "AUD", "AUD"), "$118,066");
  assert.equal(formatPrice(715.59, "USD", "AUD"), "US$715.59");
  assert.equal(formatPrice(0.6988, "USD", "USD"), "$0.6988");
});

test("price boundaries at 1000 and 1", () => {
  assert.equal(formatPrice(1000, "USD", "USD"), "$1,000");
  assert.equal(formatPrice(999.99, "USD", "USD"), "$999.99");
  assert.equal(formatPrice(1, "USD", "USD"), "$1.00");
  assert.equal(formatPrice(0.9999, "USD", "USD"), "$0.9999");
});

test("price below 1 keeps 4 significant digits however small", () => {
  assert.equal(formatPrice(0.001234, "USD", "USD"), "$0.001234");
  assert.equal(formatPrice(0.00000123, "USD", "USD"), "$0.000001230");
});

test("JPY prices use 0 decimals from 1", () => {
  assert.equal(formatPrice(150.4, "JPY", "JPY"), "¥150");
  assert.equal(formatPrice(0.6988, "JPY", "JPY"), "¥0.6988");
});

test("non-finite price renders as a dash", () => {
  assert.equal(formatPrice(NaN, "USD", "USD"), "—");
  assert.equal(formatPrice(Infinity, "USD", "USD"), "—");
});

test("money is whole units with separators and a leading minus", () => {
  assert.equal(formatMoney(1234567.6, "USD", "USD"), "$1,234,568");
  assert.equal(formatMoney(-1234, "AUD", "USD"), "-A$1,234");
  assert.equal(formatMoney(0, "USD", "USD"), "$0");
});

test("negative rounding to zero has no minus sign", () => {
  assert.equal(formatMoney(-0.4, "USD", "USD"), "$0");
});

test("bar value is full when it fits in 7 characters, compact beyond", () => {
  assert.equal(formatBarValue(118066), "118,066");
  assert.equal(formatBarValue(412300), "412,300");
  assert.equal(formatBarValue(1234567), "1.235M");
  assert.equal(formatBarValue(2450000), "2.45M");
});

test("bar value boundary at 7 characters", () => {
  assert.equal(formatBarValue(999999), "999,999");
  assert.equal(formatBarValue(1000000), "1M");
});

test("bar value compact form trims zeros and rolls over units", () => {
  assert.equal(formatBarValue(999999999), "1B");
  assert.equal(formatBarValue(3.2e9), "3.2B");
  assert.equal(formatBarValue(5e12), "5T");
});

test("bar value handles negatives and small values", () => {
  assert.equal(formatBarValue(-1234567), "-1.235M");
  assert.equal(formatBarValue(-1000), "-1,000");
  assert.equal(formatBarValue(0.6988), "0.6988");
  assert.equal(formatBarValue(NaN), "—");
});

test("bar value keeps sub-1 values in plain decimal form, never compacted", () => {
  assert.equal(formatBarValue(0.001234), "0.001234");
  assert.equal(formatBarValue(0.00000123), "0.000001230");
  assert.equal(formatBarValue(-0.00123), "-0.001230");
  for (const n of [0.001234, 0.0001234, 0.00000123, -0.00123, 1e-12]) {
    assert.doesNotMatch(formatBarValue(n), /e|k|M|B|T/);
  }
});

test("change has a space after the arrow", () => {
  assert.equal(formatChange(1.4), "▲ 1.4%");
  assert.equal(formatChange(-1.11), "▼ 1.1%");
  assert.equal(formatChange(0), "— 0.0%");
  assert.equal(formatChange(null), "—");
});

test("change that rounds to zero is flat", () => {
  assert.equal(formatChange(0.04), "— 0.0%");
  assert.equal(formatChange(-0.04), "— 0.0%");
  assert.equal(formatChange(0.05), "▲ 0.1%");
  assert.equal(formatChange(-0.05), "▼ 0.1%");
  assert.equal(formatChange(undefined), "—");
  assert.equal(formatChange(NaN), "—");
});

test("signed money", () => assert.equal(formatSigned(16630, "AUD", "AUD"), "+$16,630"));

test("signed money for negative, zero and rounds-to-zero", () => {
  assert.equal(formatSigned(-16630, "AUD", "AUD"), "-$16,630");
  assert.equal(formatSigned(0, "AUD", "AUD"), "$0");
  assert.equal(formatSigned(0.4, "AUD", "AUD"), "$0");
  assert.equal(formatSigned(0.5, "AUD", "AUD"), "+$1");
});

test("labels: ₿ for bitcoin, symbol otherwise", () => {
  assert.equal(assetLabel({ asset: "crypto:bitcoin", symbol: "BTC" }), "₿");
  assert.equal(assetLabel({ asset: "crypto:ethereum", symbol: "ETH" }), "ETH");
  assert.equal(assetLabel({ asset: "VOO", symbol: "VOO" }), "VOO");
});
