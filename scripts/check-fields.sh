#!/bin/sh
# Loads the real SettingsPage.qml in a headless Quickshell, with a stand-in
# panel and market, and checks that no Qt text input exists anywhere under it
# (host controls included: an editable TextInput reads the whole clipboard
# whenever it changes; see KeyField.qml), and that edits typed into its
# KeyFields still save. Local only: needs Quickshell (qs) and the Omarchy
# shell's Commons and Ui modules.
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
import Quickshell
import "file://$plugin" as P
import "file://$plugin/lib/keyfield.mjs" as Line

ShellRoot {
  id: root

  function report(name, ok, detail) {
    console.log("RESULT " + (ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? ": " + detail : ""))
  }

  // Every object under \`item\`, through visual children and other data.
  function everything(item, out) {
    out.push(item)
    var kids = item.data || item.children || []
    for (var i = 0; i < kids.length; i++) everything(kids[i], out)
    return out
  }

  function typeInto(field, text) {
    field.forceActiveFocus()
    field.key(Qt.Key_A, "a", Qt.ControlModifier)
    for (var i = 0; i < text.length; i++) field.key(0, text[i], 0)
    sink.forceActiveFocus()
  }

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
  }

  Timer {
    id: start
    interval: 300
    running: true
    onTriggered: {
      var all = everything(page, [])
      // TextInput and TextEdit, and everything built on them (TextField,
      // TextArea, SpinBox's editor), carry canPaste: the property whose upkeep
      // reads the clipboard.
      var inputs = all.filter(function(o) { return o !== null && typeof o === "object" && "canPaste" in o })
      root.report("no Qt text input under the settings page", inputs.length === 0, inputs.map(String).join(", "))
      // KeyFields, and components built on one, by their interface.
      var fields = all.filter(function(o) { return typeof o.key === "function" && typeof o.selectAll === "function" })
      root.report("the page has its six fields", fields.length === 6, fields.map(function(f) { return JSON.stringify(f.text || f.placeholderText) }).join(" "))
      root.report("key codes match Qt's", Line.KEY.Left === Qt.Key_Left && Line.KEY.Right === Qt.Key_Right
        && Line.KEY.Home === Qt.Key_Home && Line.KEY.End === Qt.Key_End && Line.KEY.Backspace === Qt.Key_Backspace
        && Line.KEY.Delete === Qt.Key_Delete && Line.KEY.A === Qt.Key_A && Line.MOD.Control === Qt.ControlModifier
        && Line.MOD.Shift === Qt.ShiftModifier && Line.MOD.Alt === Qt.AltModifier && Line.MOD.Meta === Qt.MetaModifier)

      var byText = function(t) { return fields.filter(function(f) { return f.text === t }) }
      var byPlaceholder = function(p) { return fields.filter(function(f) { return f.placeholderText.indexOf(p) === 0 })[0] }
      var refresh = byText("60")[0], rotate = byText("5")[0], quantity = byText("12")[0], cost = byText("410.25")[0]
      root.report("each field shows its stored value", !!(refresh && rotate && quantity && cost))

      root.typeInto(refresh, "90")
      root.report("a typed interval saves", stubPanel.settings.refreshSeconds === 90, JSON.stringify(stubPanel.settings))
      root.typeInto(refresh, "30")
      root.report("an interval under the floor saves the floor and says so",
        stubPanel.settings.refreshSeconds === 60 && page.refreshSnapped === true, JSON.stringify(stubPanel.settings))
      root.typeInto(rotate, "1x2")
      root.report("letters are not typed into an interval", stubPanel.settings.rotateSeconds === 12, JSON.stringify(stubPanel.settings))

      root.typeInto(quantity, "15.5")
      var last = stubMarket.saved[stubMarket.saved.length - 1]
      root.report("a typed quantity saves", !!last && last[0].quantity === 15.5, JSON.stringify(stubMarket.saved))
      var before = stubMarket.saved.length
      cost.forceActiveFocus()
      sink.forceActiveFocus()
      root.report("visiting a field without typing saves nothing", stubMarket.saved.length === before, stubMarket.saved.length)

      // The ▴▾ stepper and arrow keys go through stepBy on the field's row. The
      // stand-in market keeps its config, so the stored value is still 5.
      rotate.parent.stepBy(1)
      root.report("a step up saves", stubPanel.settings.rotateSeconds === 6, JSON.stringify(stubPanel.settings))
      stubMarket.config = Object.assign({}, stubMarket.config, { rotateSeconds: 3600, refreshSeconds: 60 })
      root.report("a value saved elsewhere is shown", rotate.text === "3,600" || rotate.text === "3600", rotate.text)
      var saves = JSON.stringify(stubPanel.settings)
      rotate.parent.stepBy(1)
      refresh.parent.stepBy(-1)
      root.report("steps stop at the ends", JSON.stringify(stubPanel.settings) === saves, JSON.stringify(stubPanel.settings))
      refresh.forceActiveFocus()
      refresh.key(0, "9", 0)
      stubMarket.config = Object.assign({}, stubMarket.config, { refreshSeconds: 120 })
      root.report("a value saved elsewhere leaves typing alone", refresh.text === "609", refresh.text)
      sink.forceActiveFocus()

      root.typeInto(quantity, "1a5")
      last = stubMarket.saved[stubMarket.saved.length - 1]
      root.report("letters are not typed into an amount", last[0].quantity === 15, JSON.stringify(last))
      quantity.text = "1234"
      quantity.key(0, "5", 0)
      root.report("text set from outside puts the cursor at the end", quantity.text === "12345", quantity.text)
      sink.forceActiveFocus()
      stubMarket.holdingsError = "unreadable"
      root.report("amounts cannot be typed into while holdings are locked", quantity.key(0, "7", 0) === false && quantity.readOnly)
      stubMarket.holdingsError = ""

      var search = byPlaceholder("Add a holding")
      search.forceActiveFocus()
      search.key(0, "v", 0)
      search.key(0, "o", 0)
      later.start()
    }
  }

  // The search box waits 300 ms before asking.
  Timer {
    id: later
    interval: 600
    onTriggered: {
      root.report("typing in a search box searches", stubMarket.searches.indexOf("vo") >= 0, JSON.stringify(stubMarket.searches))
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
[ "$(printf '%s\n' "$results" | grep -c '^PASS')" -eq 17 ] || { echo "expected 17 passes"; status=1; }
exit "$status"
