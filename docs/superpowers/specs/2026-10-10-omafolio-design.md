# Omafolio design

Date: 2026-10-10
Status: draft for review

## Purpose

Omafolio is an Omarchy shell plugin that shows live prices and a personal
portfolio in the bar. It covers US stocks, ETFs, managed (mutual) funds and
crypto, valued in a base currency the user chooses. It began as "show the BTC
price in my top bar" and grew into a portfolio tracker for the author's own
holdings. It is built to be published.

Success looks like this:

- A glance at the bar shows the current price of anything the user follows,
  and makes clear whether that price is live, the last close of a shut market,
  or stale.
- One click shows what the portfolio is worth today, how it moved, and the
  unrealised gain, overall and per position.
- No account, no API key, and no holdings data leaves the machine.
- Adding a new market or price source later means adding one provider file.

### Prior art

[Omacoins](https://github.com/bernardcosta/omarchy-omacoins) (MIT) is a crypto
watchlist and portfolio for the Omarchy bar. Omafolio takes three things from
it: the fetch discipline in `MarketsFeed.qml`, holdings kept in a local file,
and colours taken from the active theme. Omacoins wires CoinGecko through its
model, feeds and panel, and that is why Omafolio is a new plugin rather than a
fork: the data layer is designed around providers from the start. Ported logic
is credited in `NOTICE`.

## Decisions

| Topic | Decision |
|---|---|
| Markets | US stocks, ETFs, mutual funds; crypto |
| Equity data | Yahoo Finance unofficial endpoints, no key |
| Crypto data | CoinGecko public endpoints, no key |
| Keyed providers | None in v1. The provider design allows them later. |
| Portfolio | Per holding: asset, quantity, average cost. Shows value, day move, unrealised gain. No transaction ledger. |
| Currency | Configurable base currency; everything converts into it |
| Sparklines | Panel hero and every row, for every asset type (not in the bar). Ranges 1D / 1W / 1M / 1Y. |
| Refresh | 60 s default and minimum; market-hours aware |
| Bar | Rotating ticker, one item at a time, with an `n/N` badge |
| Panel | Tabs (Portfolio, Watchlist), hero total with chart, rows with sparklines; clicking a row turns the hero into that position |
| Language | QML for UI; logic in standard JS modules (`.mjs`) with JSDoc types, checked by `tsc --checkJs`; no build step |
| Plugin id | `bonavr.omafolio` |
| Licence | MIT |

## Platform constraints

- Omarchy plugins are QML loaded into the long-running `omarchy-shell`
  (Quickshell 0.3.1, Qt 6.11 at time of writing).
- `omarchy plugin add` clones the repo and `update` pulls it. Nothing is
  built or installed, so the repository is exactly what runs.
- Plugins run unsandboxed. Users are told to read the code before enabling, so
  everything that runs must be readable source.
- The plugin has one kind, `bar-widget`. The panel and settings page are
  opened from the widget, as in Omacoins.

## Architecture

Three layers of logic, each hiding one kind of knowledge, under a thin QML UI.

```
  BarWidget.qml   Panel.qml   SettingsPage.qml   Sparkline.qml      (UI)
          \            |             /
           MarketService.qml   (timers, curl, file I/O; no logic of its own)
                     |
      lib/portfolio.mjs     knows the user's money
      lib/market.mjs        knows freshness, scheduling, routing
      lib/providers/*.mjs   know each outside API
```

### Providers: knowledge of the outside world

One module per source: `lib/providers/yahoo.mjs`, `lib/providers/coingecko.mjs`.
Providers do no I/O. They turn intentions into request descriptions and
responses into common types, which makes them testable against recorded
fixtures with no network.

Each provider exports:

```js
/** @type {Provider} */
export default {
  id: "yahoo",
  quoteRequests(assets, baseCurrency)   // -> Request[]  (batched)
  parseQuotes(request, body)            // -> Quote[]    (throws ProviderError)
  historyRequests(assets, range, baseCurrency) // -> Request[]
  parseHistory(request, body)           // -> Series[]
  searchRequest(query)                  // -> Request
  parseSearch(request, body)            // -> SearchResult[]
}
```

A `Request` is `{ url, assets }`. Each provider owns its URLs, how it batches,
its symbol format and its parsing. Nothing above a provider sees a raw
response.

Provider-specific facts that stay inside providers:

- Yahoo: `v7/finance/spark` serves both quotes and history for many symbols
  in one call. Its per-symbol `meta` carries price, previous close, currency,
  instrument type, trading session and exchange timezone, so a refresh costs
  one Yahoo request. Funds report `previousClose: null`; the provider uses
  `chartPreviousClose`. `v1/finance/search` serves search. Funds have no
  intraday history, so a 1D
  request for a fund returns the last five daily NAVs. Quotes in minor units
  (for example GBp) are converted to major units here.
- CoinGecko: quotes and history are always requested in US dollars, and
  crypto is converted to the base currency through the same FX pairs as US
  stocks. Search maps CoinGecko ids to `crypto:<id>`.

### Market: where prices come from and how fresh they are

`lib/market.mjs` holds pure functions. `MarketService.qml` holds the state and
does the I/O.

**Routing.** An asset reference is a string. `crypto:<coingecko-id>` routes to
CoinGecko; anything else is a Yahoo symbol (`AAPL`, `VOO`, `VTSAX`). This
string is the only asset identity the UI and portfolio code handle.

**FX.** For each non-base currency in play, Market adds the Yahoo pair
`<CCY><BASE>=X` to the quote batch. FX rates are ordinary quotes, with the same
freshness rules.

**Price states.** Every quote is in exactly one state, worked out by
`priceState(quote, providerHealth, now)`:

| State | Meaning |
|---|---|
| live | Fresh, market open |
| closed | Market shut; the last close is the right number |
| stale | Should be updating, but its provider has failed for more than 3 minutes |
| missing | Never had a price (unknown or delisted symbol) |

Open or closed comes from the trading session that Yahoo reports with each
quote (`currentTradingPeriod.regular`, `exchangeTimezoneName`); FX pairs report
their own near-24-hour sessions. Crypto is always open.
No holiday calendar is kept.

**Scheduling.** `nextFetchAt(provider, assets, health, now)`:

- Crypto polls every `refreshSeconds` (minimum 60).
- Yahoo assets poll every `refreshSeconds` while any session is open, and
  every 15 minutes while all are closed. The first response showing an open
  session puts it back on the normal interval, so holidays and early closes
  are handled.
- On failure, a provider backs off: 60 s, 2 min, 4 min, and so on, up to 15
  minutes, and goes back to normal on the next success. Providers fail
  independently.
- A manual refresh (middle click) inside the minimum interval sends no
  request; it shows "updated Ns ago".
- History is fetched when the panel opens or the range changes, and cached
  per asset and range until it is older than the refresh interval.

**Fetch discipline** (ported from Omacoins `MarketsFeed.qml`):

- The last good data survives a failed fetch.
- A fetch asked for while one is in flight queues exactly one more request,
  carrying the latest parameters; a queued request identical to the one just
  completed is dropped.
- Every request uses `curl --max-time`, and response bodies are capped in
  size.
- Requests send no cookies and a generic user agent. Held and watched symbols
  go in the same batch.

**Quote cache.** The last known quote for each asset is saved to
`~/.cache/omafolio/quotes.json` (mode 600; symbols, prices and timestamps
only, never quantities) and loaded at startup. After a restart with no
network, everything shows its last price marked stale. Deleting the cache is
harmless.

### Portfolio: the user's money

`lib/portfolio.mjs` is pure functions over holdings plus market data:

- **Position value** = quantity × price, converted to base at the current FX.
- **Day move** = against the previous close, in base currency.
- **Unrealised gain** = value in base − (quantity × cost, converted to base
  at the current FX). When `costCurrency` is the listing currency (the
  default), gain is the market move only. When the user records cost in their
  own currency, gain includes currency movement. The README explains this.
- **Total** = sum of positions with any known price (live, closed or stale).
  A total that includes stale prices carries a stale flag listing them. A
  `missing` position cannot be valued, so it is left out and listed in the
  same flag.
- **Combined series**: each asset's history is placed on a shared time grid
  (1D: 15 minutes, 1W: hourly, 1M and 1Y: daily), gaps filled with the last
  value (weekends for stocks, intraday for funds), converted at each grid
  point's FX rate, then summed.

### Files

| File | Holds | Notes |
|---|---|---|
| `~/.config/omarchy/shell.json`, widget entry | Settings | Hot-reloads. Holds watched and bar symbols, never quantities. |
| `~/.local/share/omafolio/portfolio.json` | Holdings | Mode 600. XDG data directory, so dotfile repos that track `~/.config` don't pick it up. |
| `~/.cache/omafolio/quotes.json` | Last known quotes | Mode 600. Safe to delete. |

Settings, in the widget's `shell.json` entry:

```jsonc
{
  "id": "bonavr.omafolio",
  "baseCurrency": "USD",          // ISO code
  "refreshSeconds": 60,           // minimum 60
  "rotateSeconds": 5,
  "range": "1M",                  // 1D | 1W | 1M | 1Y, the range the panel opens on
  "nativePrices": true,           // asset prices in their own currency; false converts them to base
  "bar": ["crypto:bitcoin"],      // rotation order; "portfolio" is the total
  "watch": []                     // asset refs followed but not held
}
```

The defaults show Bitcoin with no setup.

Holdings:

```json
{ "holdings": [
  { "asset": "VOO",            "quantity": 12,     "cost": 410.25 },
  { "asset": "VTSAX",          "quantity": 30.512, "cost": 98.10 },
  { "asset": "crypto:bitcoin", "quantity": 0.05,   "cost": 61000, "costCurrency": "AUD" }
]}
```

- `cost` is average cost per unit.
- `costCurrency` is omitted when it is the asset's listing currency. Crypto
  has no listing currency (its quotes are in US dollars only because
  CoinGecko is asked in them), so crypto holdings always store it (defaulting
  to the base currency at the time of adding).

Bad values are corrected rather than reported: `refreshSeconds` below 60 is
used as 60, an unknown currency falls back to USD with a note in settings, and
an unknown bar item is skipped.

## UI

Approved mockups are in `mockups/` (`bar.html`, `panel.html`,
`settings.html`). They use the Gruvbox theme; the real widget takes its colours
from the active Omarchy theme.

### Bar widget

- Shows one item from `bar` at a time and rotates every `rotateSeconds`.
  Hovering pauses rotation. Scrolling steps through items and pauses rotation
  for a short while. Left click opens the panel. Middle click refreshes.
- Each item shows a label (₿ for Bitcoin, the ticker otherwise, 󰄨 for the
  portfolio), the value, and the day move with a space between arrow and
  number (`▲ 1.4%`).
- A trailing badge shows position in the rotation (`2/4`), so it works for any
  number of items. One item means no badge.
- **Closed** items are dimmed with a 󰒲 icon. **Stale** items keep normal
  colour and add ⚠; a tooltip names the stale assets and since when.
- Values show in full with separators when they fit in seven characters, and
  in compact form otherwise (`412.3k`).
- An asset's price is in its own currency (`nativePrices`, default on; crypto
  in US dollars) or converted to the base currency (off, falling back to the
  native price while no rate is known). Any amount not in the base currency
  carries its prefix outside the seven-character rule (`₿ US$82,699 ▲ 0.4%`
  with base AUD); the portfolio total is always in the base currency, plain.

### Panel

- **Tabs:** Portfolio and Watchlist; a settings gear.
- **Hero:** total value in base currency, the day move, the unrealised gain
  (amount and percentage), a filled chart for the selected range, a range
  picker, and the change over the range.
- **Market status line:** `󰒲 US market closed · last close Fri`. It never
  predicts the next open.
- **Rows:** asset, sparkline, value and day move, with the columns sized so
  nothing overflows; long values are truncated.
- **Position view:** clicking a row turns the hero into that position (name,
  value, quantity × price, gain, its chart, average cost, weight in the
  portfolio and today's range) and highlights the row. `← Portfolio` or Esc
  goes back. On the Watchlist tab the same view shows without the holding
  stats.
- Stale and missing assets follow the price states above, with ⚠ tooltips on
  the row and on the total.

### Settings page

One scrolling page, opened from the gear. Every change saves at once.

- **General:** base currency, a "Show prices in each asset's own currency"
  switch (`nativePrices`) with the hint "Totals, values and gains stay in
  <BASE>.", refresh interval (60 s minimum; the stepper
  can't go below it, a lower typed value snaps back on blur, and a note
  explains why), and the range the panel opens on.
- **Bar rotation:** rotation interval; the rotation list with drag to reorder
  and ✕ to remove.
- **Holdings:** quantity and average cost edited in place. The cost currency
  is auto-filled from the asset's quote currency and can be changed with ▾.
  The prefix is plain `$` when the currency is the base currency and explicit
  (`US$`, `A$`) otherwise. A `+` on each row adds it to the bar rotation and
  is highlighted when it is already there.
- **Search:** one box across Yahoo and CoinGecko results, each with a type
  badge (stock, ETF, fund, crypto). Enter adds the highlighted result and
  focuses its quantity field. Search only offers symbols that exist.
- **Watchlist:** the same search, adding to `watch`; rows have `+` and ✕.
- **Data:** a line naming where prices come from, the holdings file path, and
  an "Open folder" button for backups.

## Errors and stale data

Show the last good data, flag exactly what is wrong, never show a misleading
number, and never lose user data.

- **Provider failure** (network, rate limit, changed response shape): back
  off as above; its quotes go stale; the panel shows
  `Stock prices unavailable since 14:02 (Yahoo)`. Other providers carry on.
- **Unknown symbol** (Yahoo `Not Found`, or no CoinGecko match): the quote is
  `missing`; the row shows "not found"; the total's tooltip says it is not
  included. This only happens with hand-edited files.
- **Missing FX rate:** the affected positions behave as `missing` until a
  rate is known; a stale rate is used and flagged like any stale price.
- **Holdings file:**
  - No file is an empty portfolio; it is created on first add.
  - Writes go to a temporary file in the same directory, then rename, so a
    crash cannot leave a partial file.
  - A file that doesn't parse is never written over. The panel shows
    `portfolio.json can't be read (line N)` and the holdings editor is
    read-only until it is fixed.
- **Quote cache unreadable:** ignored and rebuilt.

## Privacy

- No account, sign-in, analytics or remote logging.
- Quantities, costs, values and the holdings file never leave the machine.
- Ticker symbols go to Yahoo and CoinGecko from the user's IP address. A
  provider could learn which assets a user follows, never how much they hold.
  The README says so and suggests a VPN for anyone who finds that too much.
  Hiding the symbols themselves is out of scope.

## Testing

- **Unit tests** (`bun test`), run against the same `.mjs` files that QML
  loads:
  - Providers, against recorded real responses kept as fixtures: Yahoo chart
    and spark for a stock, ETF, fund and FX pair; Yahoo `Not Found`; CoinGecko
    prices and history; both search endpoints. Also malformed, empty and
    oversized bodies.
  - Portfolio: value, day move and gain in base currency; cost in listing
    currency versus `costCurrency`; missing and stale FX; a missing position;
    an empty portfolio; fractional fund units; the combined series across
    7-day and 5-day markets with per-point FX.
  - Market: price states from session, time and health; the schedule while
    open and closed; backoff and its 15-minute cap; the 60 s floor; manual
    refresh inside the window. Time is a parameter, so no test waits.
  - Holdings: reading the documented format; refusing to write after a failed
    read; serialisation.
  - Settings: clamping and defaults.
- **Types:** `tsc --checkJs --noEmit` over `lib/` in CI.
- **QML:** kept thin over tested logic. Each UI change is checked by hand in
  the real bar (rotation, closed and stale states, panel, position view,
  settings) with screenshots. `omarchy plugin validate` runs in CI.
- **Live check:** `scripts/live-check.mjs` calls the real endpoints and
  confirms the response shapes still match the fixtures. Run by hand or on a
  weekly schedule, never in CI.

## Layout

```
manifest.json
BarWidget.qml        rotation, badge, tooltip; opens Panel
Panel.qml            tabs, hero, position view, rows
SettingsPage.qml
Sparkline.qml
MarketService.qml    timers, curl processes, file I/O, exposes state to UI
lib/
  types.mjs          JSDoc typedefs: AssetRef, Quote, Series, SearchResult,
                     Holding, Money, PriceState, Request
  providers/yahoo.mjs
  providers/coingecko.mjs
  providers/index.mjs   routing an AssetRef to its provider
  market.mjs         price states, scheduling, backoff, last-good merge
  portfolio.mjs      valuation, gain, FX conversion, combined series
  holdings.mjs       parse and serialise portfolio.json
  settings.mjs       defaults and clamping
  format.mjs         currency prefixes, compact numbers, arrows
tests/
  fixtures/
scripts/
  live-check.mjs
README.md  LICENSE  NOTICE
```

## Risks

| Risk | Mitigation |
|---|---|
| QML fails to load `.mjs` modules that import each other inside a plugin (no Omarchy or Omacoins code does this today) | First task of the plan is a proof. If it fails, fall back to TypeScript compiled to `.pragma library` JS with `dist/` committed; the architecture is unchanged. |
| Yahoo changes or blocks the unofficial endpoints | Contained in one provider; stale states make it visible at once; the live check catches shape changes early; a keyed provider can be added later. |
| CoinGecko's keyless tier tightens (docs already discourage scheduled polling) | One batched call per minute at most; backoff; same visibility through stale states. |
| Free equity quotes may be delayed by exchange | Show the quote's `asOf` time in the position view; don't call it "real time". |

## Out of scope for v1

- Keyed providers (Finnhub and others) and API key storage.
- Transactions, realised gains, dividends and tax lots.
- Export and import; the holdings file is a single file to copy.
- Exchanges outside the US. Yahoo symbols such as `CBA.AX` will probably work,
  but are untested and unsupported.
- Hiding which symbols are requested.
- Alerts and notifications.
