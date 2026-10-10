#!/usr/bin/env bash
# Records live provider responses into tests/fixtures/<provider>/. Run once, commit the output.
# Usage: record-fixtures.sh [yahoo|coingecko ...]   (no arguments records every provider)
set -euo pipefail
root="$(dirname "$0")/../tests/fixtures"
get() { curl -s -A 'Mozilla/5.0' --max-time 15 "$@"; }

record_yahoo() {
  local out="$root/yahoo"
  mkdir -p "$out"
  local base="https://query1.finance.yahoo.com"
  local syms="AAPL,VOO,VTSAX,USDAUD%3DX"
  get "$base/v7/finance/spark?symbols=$syms&range=1d&interval=5m" > "$out/spark-quotes.json"
  get "$base/v7/finance/spark?symbols=$syms&range=1mo&interval=1d" > "$out/spark-1M.json"
  get "$base/v7/finance/spark?symbols=$syms&range=5d&interval=1h" > "$out/spark-1W.json"
  get "$base/v7/finance/spark?symbols=VTSAX&range=5d&interval=1d" > "$out/spark-1D-fund.json"
  get -w '%{http_code}' -o "$out/spark-404.json" "$base/v7/finance/spark?symbols=NOTAREALTICKERX&range=1d&interval=5m" > "$out/spark-404.status"
  get "$base/v1/finance/search?q=vanguard%20total&quotesCount=8&newsCount=0" > "$out/search.json"
}

# CoinGecko keyless rate-limits to roughly 10-30 calls a minute, so calls are spaced out.
record_coingecko() {
  local out="$root/coingecko"
  mkdir -p "$out"
  local base="https://api.coingecko.com/api/v3"
  get "$base/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,notarealcoinx" > "$out/markets.json"
  sleep 3
  get "$base/coins/bitcoin/market_chart?vs_currency=usd&days=7" > "$out/chart-7.json"
  sleep 3
  get "$base/search?query=sol" > "$out/search.json"
}

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(yahoo coingecko)
for t in "${targets[@]}"; do "record_$t"; done
