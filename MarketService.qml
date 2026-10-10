import QtQuick
import Quickshell
import Quickshell.Io
import "lib/settings.mjs" as Settings
import "lib/market.mjs" as Market
import "lib/portfolio.mjs" as Portfolio
import "lib/holdings.mjs" as Holdings
import "lib/quotecache.mjs" as QuoteCache
import "lib/providers/index.mjs" as Providers

// Prices, history, search and holdings for the widget and panel. This is the
// plugin's only I/O: curl (through Fetcher), timers and two files. Every
// decision (what to fetch, when, how fresh a price is, what the portfolio is
// worth) is made by lib/; this object holds the state and runs the processes.
//
// - Quotes: each provider polls on its own timer, re-armed after every round
//   with market.nextDelayMs, so providers back off and recover independently.
//   Assets come from holdings and settings, plus the FX pairs the portfolio
//   needs; a round starts straight away whenever new assets appear (including
//   FX pairs learnt from a response) and never when there is nothing to fetch.
// - Holdings: ~/.local/share/omafolio/portfolio.json, watched for edits. A file
//   that does not parse sets holdingsError and is never written over.
// - Quote cache: ~/.cache/omafolio/quotes.json, loaded at startup (those quotes
//   are marked fromCache, so they show as stale until refreshed) and rewritten
//   after successful fetches.
// Both files are written atomically with mode 600.
//
// This is the plugin's `service` entry point: the shell mounts one instance and
// every bar widget (one per monitor) shares it, so each request and each file
// write happens once. Widgets find it with bar.shell.serviceFor(<plugin id>)
// and push their settings into `settings`.
QtObject {
  id: root

  default property list<QtObject> resources

  // ---- Inputs

  // The widget's settings entry, raw or already normalised (normalising is
  // idempotent); bad values are replaced and explained in `notes`. Null until a
  // widget supplies it, and nothing is fetched before then, so the defaults are
  // never fetched by mistake. Every widget pushes the same bar entry.
  property var settings: null
  // Whether the panel is showing. history() fetches only while it is.
  property bool panelOpen: false

  // ---- Outputs

  // The settings in effect (lib/settings.mjs Settings).
  readonly property var config: normalized.settings
  // Latest quote per asset, FX pairs included: Record<AssetRef, Quote>.
  property var quotes: ({})
  // Price state of every quote and every asset being fetched:
  // Record<AssetRef, PriceState>. Recomputed on every data change and every
  // 15 s, since staleness depends on the time.
  readonly property var states: priceStates()
  // Holding[] from the holdings file. While the file is unreadable this keeps
  // the last good list (empty at startup).
  property var holdings: []
  // Empty when the holdings file is fine (or absent); otherwise a sentence for
  // the user, e.g. "portfolio.json can't be read (line 4)". Saving is blocked.
  property string holdingsError: ""
  // lib/portfolio.mjs PortfolioView of `holdings` in the base currency.
  readonly property var portfolio: Portfolio.valuePortfolio(holdings, quotes, states, config.baseCurrency)
  // Health (lib/types.mjs) per provider id: {yahoo: Health, coingecko: Health}.
  property var providerHealth: ({
    yahoo: { failures: 0, failingSince: null, lastSuccess: null },
    coingecko: { failures: 0, failingSince: null, lastSuccess: null },
  })
  // User-facing explanations: substituted settings, merged duplicate holdings.
  readonly property var notes: normalized.notes.concat(holdingsMerged > 0
    ? ["portfolio.json has " + holdingsMerged + " duplicate " + (holdingsMerged === 1 ? "entry" : "entries")
      + "; they are shown combined and saved combined on the next change."]
    : [])
  // Epoch ms of the last successful quote round of any provider, or null.
  property var lastUpdated: null
  // SearchResult[] for the latest search(): Yahoo first, then CoinGecko, one
  // per asset.
  property var searchResults: []

  // ---- Methods

  // Manual refresh: starts a round for each provider whose last attempt is at
  // least refreshSeconds old (market.canFetchNow) and re-reads the holdings
  // file. Returns whether any request went out.
  function refresh() {
    holdingsFile.reload()
    var now = Date.now()
    var started = false
    for (const feed of [yahooFeed, coingeckoFeed]) {
      if (feed.assets.length > 0 && Market.canFetchNow(feed.lastAttemptAt, config.refreshSeconds, now)) {
        feed.start()
        started = true
      }
    }
    return started
  }

  // Price history of `assets` (AssetRef[]) over `range` ("1D"|"1W"|"1M"|"1Y"):
  // Record<AssetRef, Series> holding the cached series that exist. While the
  // panel is open, series that are absent or older than refreshSeconds are
  // fetched in the background; bindings that call this re-evaluate when they
  // land. An asset the provider has no history for is absent from the result.
  function history(assets, range) {
    var cache = historyCache
    var now = clock
    var base = config.baseCurrency
    var maxAge = config.refreshSeconds * 1000
    var out = {}
    var due = []
    for (const asset of assets) {
      var key = historyKey(base, range, asset)
      var entry = cache[key]
      if (entry && entry.series) out[asset] = entry.series
      if (panelOpen && !historyPending[key] && (!entry || now - entry.at >= maxAge)) due.push(asset)
    }
    if (due.length > 0) {
      for (const request of Providers.historyRequests(due, range, base, kindOf)) {
        for (const asset of request.assets) historyPending[historyKey(base, range, asset)] = true
        historyQueue.push({ request: request, base: base })
      }
      historyPump.restart()
    }
    return out
  }

  // Searches both providers for `query`; results replace `searchResults` as
  // each provider answers. A blank query clears them. Answers to an older query
  // are ignored.
  function search(query) {
    var q = String(query === undefined || query === null ? "" : query).trim()
    var requests = q === "" ? [] : Providers.searchRequests(q)
    searchUrls = requests.map(function(r) { return r.url })
    searchByProvider = {}
    searchResults = []
    searchFetcher.fetch(requests)
  }

  // Writes `list` (Holding[]) to the holdings file, merged as parseHoldings
  // would read it back, and adopts it at once. Refused (returns false) while
  // holdingsError is set, before the file has first been read, or when the
  // list would not read back.
  function saveHoldings(list) {
    if (holdingsError !== "" || !ready) return false
    var text = Holdings.serializeHoldings(list)
    var check = Holdings.parseHoldings(text)
    if (!check.ok) {
      console.warn("omafolio: not saving holdings that would not read back: " + check.error)
      return false
    }
    holdingsText = text
    holdings = check.holdings
    holdingsMerged = 0
    holdingsWriter.write(text)
    return true
  }

  // ---- Implementation

  readonly property string home: Quickshell.env("HOME")
  readonly property string holdingsPath: home + "/.local/share/omafolio/portfolio.json"
  readonly property string cachePath: home + "/.cache/omafolio/quotes.json"

  // The host hands settings over as Qt types (lists are not JS arrays), so they
  // are copied into plain JSON values before validation.
  readonly property var normalized: Settings.normalizeSettings(plainJson(settings))
  // Assets the user follows, and the FX pairs needed to value them.
  readonly property var wanted: Market.assetsToFetch(config, holdings)
  readonly property var fx: Market.fxPairs(quotesOf(wanted), holdings, config.baseCurrency)
  // Assets requested whose provider answered without them (unknown symbols).
  property var notFoundAssets: ({})
  // Now, in epoch ms, advanced every 15 s so time-dependent bindings update.
  property real clock: Date.now()

  // The holdings file has been read (or found absent) at least once. Nothing
  // is fetched or saved before then.
  property bool ready: false
  // Text of the holdings file as last read or written; null forces a re-parse.
  property var holdingsText: null
  property int holdingsMerged: 0

  // Quote cache text as last read or written, to skip unchanged writes.
  property string cacheText: ""

  // History: "base|range|asset" -> {at: epoch ms, series: Series|null}; keys
  // requested and not yet answered; requests waiting their turn; and the one
  // in flight ({request, base}).
  property var historyCache: ({})
  property var historyPending: ({})
  property var historyQueue: []
  property var historyCurrent: null

  property var searchUrls: []
  property var searchByProvider: ({})

  function plainJson(value) {
    var text = value === undefined ? undefined : JSON.stringify(value)
    return text === undefined ? {} : JSON.parse(text)
  }

  function quotesOf(assets) {
    var out = {}
    for (const asset of assets) if (quotes[asset]) out[asset] = quotes[asset]
    return out
  }

  // Assets `provider` should be asked for now, in a stable order.
  function assetsFor(provider) {
    return Array.from(new Set(wanted.concat(fx))).filter(function(a) {
      return Providers.providerFor(a).id === provider
    })
  }

  function kindOf(asset) {
    var quote = quotes[asset]
    return quote ? quote.kind : undefined
  }

  function priceStates() {
    var now = clock
    var out = {}
    var assets = Object.keys(quotes).concat(wanted, fx)
    for (const asset of assets) {
      out[asset] = notFoundAssets[asset]
        ? "missing"
        : Market.priceState(quotes[asset], providerHealth[Providers.providerFor(asset).id], now)
    }
    return out
  }

  // Merges a provider's answer to `requested` (AssetRef[]); requested assets
  // it left out are marked not found until a later answer includes them.
  function acceptQuotes(requested, fresh) {
    quotes = Market.mergeQuotes(quotes, fresh)
    var missing = Market.notFound(requested, fresh)
    var next = Object.assign({}, notFoundAssets)
    for (const asset of requested) {
      if (missing.indexOf(asset) >= 0) next[asset] = true
      else delete next[asset]
    }
    notFoundAssets = next
  }

  function setHealth(provider, health) {
    var next = Object.assign({}, providerHealth)
    next[provider] = health
    providerHealth = next
  }

  function holdingsRead(text) {
    // Our own write is the truth until the last one lands; a read in between
    // would only roll it back.
    if (holdingsWriter.busy) return
    if (ready && text === holdingsText) return
    holdingsText = text
    var result = Holdings.parseHoldings(text)
    if (result.ok) {
      holdings = result.holdings
      holdingsMerged = result.merged
      holdingsError = ""
    } else {
      holdingsError = result.line !== null
        ? "portfolio.json can't be read (line " + result.line + ")"
        : "portfolio.json can't be read: " + result.error
    }
    ready = true
  }

  function holdingsUnreadable(error) {
    if (holdingsWriter.busy) return
    // No file is an empty portfolio; it is created on the first save.
    if (error === FileViewError.FileNotFound) {
      holdingsRead("")
      return
    }
    holdingsText = null
    holdingsError = "portfolio.json can't be read (" + FileViewError.toString(error) + ")"
    ready = true
  }

  // Adopts cached quotes (lib/quotecache.mjs drops malformed entries) for
  // assets that have no fresher quote yet.
  function cacheRead(text) {
    quotes = Object.assign(QuoteCache.parseQuoteCache(text), quotes)
    cacheText = text
  }

  function writeCache() {
    var text = QuoteCache.serializeQuoteCache(quotes)
    if (text === cacheText) return
    cacheText = text
    cacheWriter.write(text)
  }

  function historyKey(base, range, asset) {
    return base + "|" + range + "|" + asset
  }

  // Records the answer to the history request in flight: `series` is the
  // parsed Series[], or null when the request failed, in which case the last
  // good series are kept. Either way the attempt time is recorded, so a failing
  // request is retried after refreshSeconds rather than at once.
  function storeHistory(series) {
    var current = historyCurrent
    var request = current.request
    var now = Date.now()
    var next = Object.assign({}, historyCache)
    for (const asset of request.assets) {
      var key = historyKey(current.base, request.range, asset)
      var found = series ? series.find(function(s) { return s.asset === asset }) : undefined
      var previous = next[key] ? next[key].series : null
      next[key] = { at: now, series: series ? (found || null) : previous }
      delete historyPending[key]
    }
    historyCache = next
  }

  function publishSearch() {
    var seen = {}
    var out = []
    for (const provider of ["yahoo", "coingecko"]) {
      for (const result of searchByProvider[provider] || []) {
        if (seen[result.asset]) continue
        seen[result.asset] = true
        out.push(result)
      }
    }
    searchResults = out
  }

  onPanelOpenChanged: {
    if (panelOpen) return
    // Closing the panel cancels history requests still waiting their turn.
    for (const item of historyQueue) {
      for (const asset of item.request.assets) delete historyPending[historyKey(item.base, item.request.range, asset)]
    }
    historyQueue = []
  }

  // ---- Quote polling, one feed per provider.

  // Polls one provider's quotes with its own Fetcher and Timer, so providers
  // fail, back off and recover independently.
  component QuoteFeed: QtObject {
    id: feed

    required property string provider
    required property QtObject service

    // Assets this provider should be asked for now (none until the holdings
    // file has been read and a widget has supplied settings).
    readonly property var assets: service.ready && service.settings !== null ? service.assetsFor(provider) : []
    readonly property string wantKey: service.config.baseCurrency + "|" + assets.join(",")
    // What the latest round asked for (crypto prices depend on the base currency).
    property var requested: []
    property string requestedBase: ""
    property var lastAttemptAt: null
    // Whether any request of the round in flight has failed.
    property bool roundFailed: false

    // New assets, or a new base currency, are fetched at once; the rest wait
    // for the timer.
    onWantKeyChanged: {
      if (assets.length === 0) {
        timer.stop()
        requested = []
        return
      }
      var base = service.config.baseCurrency
      if (base !== requestedBase || assets.some(function(a) { return requested.indexOf(a) < 0 })) kick.restart()
    }

    // Starts a round now (queued behind one in flight). With nothing to fetch
    // there is no round and no timer until assets appear.
    function start() {
      timer.stop()
      if (assets.length === 0) return
      var base = service.config.baseCurrency
      requested = assets
      requestedBase = base
      lastAttemptAt = Date.now()
      fetcher.fetch(Providers.quoteRequests(assets, base))
    }

    function fail(reason) {
      roundFailed = true
      console.warn("omafolio: " + provider + " quotes failed: " + reason)
    }

    function finishRound() {
      var now = Date.now()
      var health = roundFailed
        ? Market.recordFailure(service.providerHealth[provider], now)
        : Market.recordSuccess(service.providerHealth[provider], now)
      service.setHealth(provider, health)
      if (!roundFailed) {
        service.lastUpdated = now
        cacheDebounce.restart()
      }
      roundFailed = false
      timer.interval = Market.nextDelayMs(provider, service.quotes, health, service.config.refreshSeconds, now)
      timer.restart()
    }

    readonly property Timer kick: Timer {
      interval: 0
      onTriggered: feed.start()
    }

    readonly property Timer timer: Timer {
      onTriggered: feed.start()
    }

    readonly property Fetcher fetcher: Fetcher {
      onFinished: function(request, status, body) {
        var fresh
        try {
          fresh = Providers.parse(request, status, body)
        } catch (e) {
          feed.fail(e.message)
          return
        }
        feed.service.acceptQuotes(request.assets, fresh)
      }
      onFailed: function(request, reason) { feed.fail(reason) }
      onDone: feed.finishRound()
    }
  }

  readonly property QuoteFeed yahooFeed: QuoteFeed { provider: "yahoo"; service: root }
  readonly property QuoteFeed coingeckoFeed: QuoteFeed { provider: "coingecko"; service: root }

  // ---- History and search fetchers.

  readonly property Fetcher historyFetcher: Fetcher {
    onFinished: function(request, status, body) {
      try {
        root.storeHistory(Providers.parse(request, status, body))
      } catch (e) {
        console.warn("omafolio: history failed: " + e.message)
        root.storeHistory(null)
      }
    }
    onFailed: function(request, reason) {
      console.warn("omafolio: history failed: " + reason)
      root.storeHistory(null)
    }
    onDone: {
      root.historyCurrent = null
      historyPump.restart()
    }
  }

  // Feeds queued history requests to the fetcher one at a time.
  readonly property Timer historyPump: Timer {
    interval: 0
    onTriggered: {
      if (root.historyFetcher.busy || root.historyQueue.length === 0) return
      root.historyCurrent = root.historyQueue.shift()
      root.historyFetcher.fetch([root.historyCurrent.request])
    }
  }

  readonly property Fetcher searchFetcher: Fetcher {
    onFinished: function(request, status, body) {
      if (root.searchUrls.indexOf(request.url) < 0) return
      var results = []
      try {
        results = Providers.parse(request, status, body)
      } catch (e) {
        console.warn("omafolio: " + request.provider + " search failed: " + e.message)
      }
      var next = Object.assign({}, root.searchByProvider)
      next[request.provider] = results
      root.searchByProvider = next
      root.publishSearch()
    }
    onFailed: function(request, reason) {
      if (root.searchUrls.indexOf(request.url) >= 0) console.warn("omafolio: " + request.provider + " search failed: " + reason)
    }
  }

  // ---- Files

  readonly property FileView holdingsFile: FileView {
    path: root.holdingsPath
    watchChanges: true
    printErrors: false
    onLoaded: root.holdingsRead(text())
    onLoadFailed: function(error) { root.holdingsUnreadable(error) }
    onFileChanged: reload()
  }

  readonly property AtomicFile holdingsWriter: AtomicFile {
    path: root.holdingsPath
    // Re-read once the last queued write has landed, so the file stays the truth.
    onWritten: function(ok) {
      if (!ok) console.warn("omafolio: could not write " + root.holdingsPath)
      if (!busy) {
        root.holdingsText = null
        root.holdingsFile.reload()
      }
    }
  }

  readonly property FileView cacheFile: FileView {
    path: root.cachePath
    printErrors: false
    onLoaded: root.cacheRead(text())
  }

  readonly property AtomicFile cacheWriter: AtomicFile {
    path: root.cachePath
    onWritten: function(ok) {
      if (ok) return
      console.warn("omafolio: could not write " + root.cachePath)
      root.cacheText = ""
    }
  }

  // Successes from both providers usually land within seconds of each other;
  // one write covers them.
  readonly property Timer cacheDebounce: Timer {
    interval: 10000
    onTriggered: root.writeCache()
  }

  // Advances `clock`, and re-reads the holdings file, which also picks up a
  // file created after startup or replaced in a way the watch misses.
  readonly property Timer ticker: Timer {
    interval: 15000
    running: true
    repeat: true
    onTriggered: {
      root.clock = Date.now()
      root.holdingsFile.reload()
    }
  }

  // Replaces a file's contents atomically: mktemp (mode 600, unpredictable
  // name) in the target's directory, write, then rename over the target, so a
  // crash never leaves a partial file and a planted symlink is replaced, not
  // written through. Writes queue: while one runs, the latest text waits.
  // Pattern from Omacoins' Panel.qml (MIT, Bernard Costa).
  component AtomicFile: QtObject {
    id: writer

    required property string path
    // Whether a write is running or waiting.
    readonly property bool busy: proc.running || hasPending || landing
    property string pending: ""
    property bool hasPending: false
    property bool landing: false
    property bool lastOk: true

    // Emitted after each write, `ok` false when it failed (the file is then
    // unchanged).
    signal written(bool ok)

    function write(text) {
      pending = text
      hasPending = true
      flush()
    }

    function flush() {
      if (proc.running || landing || !hasPending) return
      var text = pending
      pending = ""
      hasPending = false
      // Path and text travel as arguments, never inside the script.
      proc.command = ["sh", "-c",
        'umask 077; d=$(dirname -- "$0") && mkdir -p -- "$d" && t=$(mktemp -- "$d/.omafolio.XXXXXX") || exit 1; '
        + 'printf "%s" "$1" > "$t" && mv -f -- "$t" "$0" || { rm -f -- "$t"; exit 1; }',
        writer.path, text]
      proc.running = true
    }

    readonly property Process proc: Process {
      onExited: function(code, exitStatus) {
        writer.lastOk = code === 0 && exitStatus === 0
        writer.landing = true
        after.restart()
      }
    }

    // Reports and starts the next write outside Process's own signal handler.
    readonly property Timer after: Timer {
      interval: 0
      onTriggered: {
        writer.landing = false
        writer.flush()
        writer.written(writer.lastOk)
      }
    }
  }
}
