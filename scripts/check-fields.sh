#!/bin/sh
# Loads the real SettingsPage.qml in a headless Quickshell, with a stand-in
# panel and market, and checks two things. No object under the page, popup
# contents and host controls included, is a Qt text input: an editable
# TextInput reads the whole clipboard whenever it changes (see KeyField.qml).
# And the page's KeyFields still work, driven with real key presses and clicks
# through QtTest. Local only: needs Quickshell (qs), Qt's QtTest module and the
# Omarchy shell's Commons and Ui modules.
set -eu
cd "$(dirname "$0")/.."
plugin=$PWD
shell=${OMARCHY_SHELL:-/usr/share/omarchy/shell}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM

# `import qs.Commons` resolves against the config root.
ln -s "$shell/Commons" "$tmp/Commons"
ln -s "$shell/Ui" "$tmp/Ui"

cat > "$tmp/shell.qml" <<QML
import QtQuick
import QtTest
import Quickshell
import "file://$plugin" as P
import "file://$plugin/lib/keyfield.mjs" as Line

ShellRoot {
  id: root

  function report(name, ok, detail) {
    console.log("RESULT " + (ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? ": " + detail : ""))
  }

  // Every object under \`item\`: visual children, other data, and the content
  // of controls and popups, which neither of those reaches.
  function everything(item, out) {
    if (!item || typeof item !== "object" || out.indexOf(item) >= 0) return out
    out.push(item)
    var kids = [].concat(Array.from(item.data || item.children || []),
      Array.from(item.contentData || []), [item.contentItem, item.background])
    for (var i = 0; i < kids.length; i++) everything(kids[i], out)
    return out
  }

  // Clicks the field, selects all with Ctrl+A, types \`text\` and presses \`last\`
  // (Enter unless given).
  function typeInto(field, text, last) {
    tc.mouseClick(field, field.width / 2, field.height / 2)
    tc.keyClick(Qt.Key_A, Qt.ControlModifier)
    for (var i = 0; i < text.length; i++) tc.keyClick(text[i])
    tc.keyClick(last === undefined ? Qt.Key_Return : last)
  }

  function settings() { return JSON.stringify(stubPanel.settings) }

  property var search: null

  QtObject {
    id: stubMarket
    property var config: ({ baseCurrency: "USD", refreshSeconds: 60, rotateSeconds: 5, range: "1M",
      bar: ["crypto:bitcoin"], watch: ["AAPL"], nativePrices: true })
    property var holdings: [{ asset: "VOO", quantity: 12, cost: 410.25 }]
    property var quotes: ({})
    property string holdingsError: ""
    property string holdingsNote: ""
    property string holdingsPath: "/tmp/omafolio/portfolio.json"
    property string home: "/tmp"
    property var settingsNotes: []
    property bool searching: false
    property string searchQuery: ""
    property var searchResults: []
    property var saved: []
    property var searches: []
    function saveHoldings(list) { saved = saved.concat([list]); holdings = list; return true }
    function search(q) { searches = searches.concat([q]); searchQuery = q }
  }

  // The stand-in keeps its config: a saved setting lands in \`settings\` only,
  // so the stored values stay as above until a check changes the config.
  QtObject {
    id: stubPanel
    property var market: stubMarket
    property var settings: ({ id: "bonavr.omafolio" })
    property string moduleName: "bonavr.omafolio"
    property var hostWidget: null
    property var bar: null
    property color fg: "white"
    property string fontFamily: "monospace"
    function releaseFocus() { sink.forceActiveFocus() }
  }

  FloatingWindow {
    visible: true
    implicitWidth: 420
    implicitHeight: 1400
    Item { id: sink; focus: true }
    P.SettingsPage { id: page; width: 400; panel: stubPanel }
    TestCase { id: tc; when: false; optional: true }
  }

  Timer {
    interval: 300
    running: true
    onTriggered: {
      var all = everything(page, [])
      // TextInput and TextEdit, and everything built on them (TextField,
      // TextArea, SpinBox's editor), carry canPaste: the property whose upkeep
      // reads the clipboard.
      var inputs = all.filter(function(o) { return "canPaste" in o })
      root.report("no Qt text input under the settings page", inputs.length === 0, inputs.map(String).join(", "))
      // KeyFields, and components built on one, by their interface.
      var fields = all.filter(function(o) { return typeof o.key === "function" && typeof o.selectAll === "function" })
      root.report("the page has its six fields", fields.length === 6,
        fields.map(function(f) { return JSON.stringify(f.text || f.placeholderText) }).join(" "))
      root.report("key codes match Qt's", Line.KEY.Left === Qt.Key_Left && Line.KEY.Right === Qt.Key_Right
        && Line.KEY.Home === Qt.Key_Home && Line.KEY.End === Qt.Key_End && Line.KEY.Backspace === Qt.Key_Backspace
        && Line.KEY.Delete === Qt.Key_Delete && Line.KEY.A === Qt.Key_A && Line.MOD.Control === Qt.ControlModifier
        && Line.MOD.Shift === Qt.ShiftModifier && Line.MOD.Alt === Qt.AltModifier && Line.MOD.Meta === Qt.MetaModifier)

      var byText = function(t) { return fields.filter(function(f) { return f.text === t })[0] }
      var byPlaceholder = function(p) { return fields.filter(function(f) { return f.placeholderText.indexOf(p) === 0 })[0] }
      var refresh = byText("60"), rotate = byText("5"), quantity = byText("12"), cost = byText("410.25")
      root.search = byPlaceholder("Add a holding")
      root.report("each field shows its stored value", !!(refresh && rotate && quantity && cost && root.search))

      // Intervals.
      root.typeInto(refresh, "90")
      root.report("a typed interval saves on Enter and lets go of the keyboard",
        stubPanel.settings.refreshSeconds === 90 && !refresh.activeFocus, root.settings())
      root.typeInto(refresh, "30")
      root.report("an interval under the floor saves the floor and says so",
        stubPanel.settings.refreshSeconds === 60 && page.refreshSnapped === true, root.settings())
      root.typeInto(rotate, "3000000")
      root.report("an interval over the ceiling saves the ceiling", stubPanel.settings.rotateSeconds === 3600, root.settings())
      root.typeInto(rotate, "1x2")
      root.report("letters are not typed into an interval", stubPanel.settings.rotateSeconds === 12, root.settings())
      root.typeInto(rotate, "7", Qt.Key_Escape)
      root.report("Esc puts the stored value back and saves nothing",
        rotate.text === "5" && !rotate.activeFocus && stubPanel.settings.rotateSeconds === 12, rotate.text + " " + root.settings())
      tc.mouseClick(rotate, rotate.width / 2, rotate.height / 2)
      tc.keyClick(Qt.Key_Up)
      root.report("Up steps from the stored value and saves", stubPanel.settings.rotateSeconds === 6, root.settings())
      stubMarket.config = Object.assign({}, stubMarket.config, { rotateSeconds: 3600 })
      root.report("a value saved elsewhere is shown", rotate.text === "3,600" || rotate.text === "3600", rotate.text)
      var before = root.settings()
      tc.keyClick(Qt.Key_Up)
      tc.mouseClick(refresh, refresh.width / 2, refresh.height / 2)
      tc.keyClick(Qt.Key_Down)
      root.report("steps stop at the ends", root.settings() === before, root.settings())
      tc.keyClick(Qt.Key_End)
      tc.keyClick("9")
      stubMarket.config = Object.assign({}, stubMarket.config, { refreshSeconds: 120 })
      root.report("a value saved elsewhere leaves typing alone", refresh.text === "609", refresh.text)
      tc.keyClick(Qt.Key_Escape)

      // Amounts.
      root.typeInto(quantity, "15.5")
      var last = stubMarket.saved[stubMarket.saved.length - 1]
      root.report("a typed quantity saves", !!last && last[0].quantity === 15.5, JSON.stringify(stubMarket.saved))
      var count = stubMarket.saved.length
      tc.mouseClick(cost, cost.width / 2, cost.height / 2)
      tc.keyClick(Qt.Key_Return)
      root.report("visiting a field without typing saves nothing", stubMarket.saved.length === count, stubMarket.saved.length)
      root.typeInto(quantity, "1a5")
      last = stubMarket.saved[stubMarket.saved.length - 1]
      root.report("letters are not typed into an amount", last[0].quantity === 15, JSON.stringify(last))
      quantity.text = "1234"
      quantity.forceActiveFocus()
      tc.keyClick("5")
      root.report("text set from outside puts the cursor at the end", quantity.text === "12345", quantity.text)
      tc.keyClick(Qt.Key_V, Qt.ControlModifier)
      tc.keyClick(Qt.Key_Insert, Qt.ShiftModifier)
      root.report("Ctrl+V and Shift+Insert do nothing", quantity.text === "12345", quantity.text)
      // The cursor at the end of right-aligned text stays inside the clipped box.
      var caret = everything(quantity, []).filter(function(o) { return o.width === 1 && o.parent && o.parent.clip })[0]
      root.report("the cursor shows at the end of right-aligned text",
        !!caret && caret.x >= 0 && caret.x + caret.width <= caret.parent.width, caret ? caret.x + " of " + caret.parent.width : "none")
      tc.keyClick(Qt.Key_Escape)
      // Holdings can become locked while a field has the keyboard.
      quantity.forceActiveFocus()
      stubMarket.holdingsError = "unreadable"
      tc.keyClick("7")
      root.report("a field locked while it has the keyboard takes no keys", quantity.text === "15", quantity.text)
      sink.forceActiveFocus()
      tc.mouseClick(quantity, quantity.width / 2, quantity.height / 2)
      tc.keyClick("7")
      root.report("amounts take no keys while holdings are locked", !quantity.activeFocus && quantity.text === "15", quantity.text)
      stubMarket.holdingsError = ""
      // The search box is hidden while holdings are locked; let it lay out again.
      tc.wait(50)

      // Search.
      tc.mouseClick(root.search, root.search.width / 2, root.search.height / 2)
      tc.keyClick("v")
      tc.keyClick("o")
      later.start()
    }
  }

  // The search box waits 300 ms before asking.
  Timer {
    id: later
    interval: 600
    onTriggered: {
      root.report("typing in a search box searches", stubMarket.searches.indexOf("vo") >= 0, JSON.stringify(stubMarket.searches))
      tc.keyClick(Qt.Key_Escape)
      root.report("Esc empties the search box and lets go of the keyboard",
        root.search.text === "" && !root.search.activeFocus, JSON.stringify(root.search.text))
      Qt.quit()
    }
  }

  Timer {
    interval: 20000
    running: true
    onTriggered: { root.report("finished in time", false); Qt.quit() }
  }
}
QML

out=$(env -u WAYLAND_DISPLAY QT_QPA_PLATFORM=offscreen timeout 60 qs -p "$tmp" 2>&1) || true
results=$(printf '%s\n' "$out" | sed -n 's/.*RESULT //p')
if [ -z "$results" ]; then
  echo "Quickshell reported nothing:"
  printf '%s\n' "$out" | tail -20
  exit 1
fi
printf '%s\n' "$results"
status=0
printf '%s\n' "$results" | grep -q '^FAIL' && status=1
[ "$(printf '%s\n' "$results" | grep -c '^PASS')" -eq 23 ] || { echo "expected 23 passes"; status=1; }
exit "$status"
