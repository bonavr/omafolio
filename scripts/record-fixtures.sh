#!/usr/bin/env bash
# Records live Yahoo responses into tests/fixtures/yahoo/. Run once, commit the output.
set -euo pipefail
out="$(dirname "$0")/../tests/fixtures/yahoo"
mkdir -p "$out"
base="https://query1.finance.yahoo.com"
syms="AAPL,VOO,VTSAX,USDAUD%3DX"
get() { curl -s -A 'Mozilla/5.0' --max-time 15 "$@"; }
get "$base/v7/finance/spark?symbols=$syms&range=1d&interval=5m" > "$out/spark-quotes.json"
get "$base/v7/finance/spark?symbols=$syms&range=1mo&interval=1d" > "$out/spark-1M.json"
get "$base/v7/finance/spark?symbols=$syms&range=5d&interval=1h" > "$out/spark-1W.json"
get "$base/v7/finance/spark?symbols=VTSAX&range=5d&interval=1d" > "$out/spark-1D-fund.json"
get -w '%{http_code}' -o "$out/spark-404.json" "$base/v7/finance/spark?symbols=NOTAREALTICKERX&range=1d&interval=5m" > "$out/spark-404.status"
get "$base/v1/finance/search?q=vanguard%20total&quotesCount=8&newsCount=0" > "$out/search.json"
