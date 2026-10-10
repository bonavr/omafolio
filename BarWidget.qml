import QtQuick
import qs.Commons
import qs.Ui

// Placeholder pill; replaced by the real widget when the data layer lands.
// For now it shows how many quotes MarketService holds.
BarWidget {
  id: root
  moduleName: "bonavr.omafolio"
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  // The shell's single MarketService (this plugin's service entry point),
  // shared by the widget on every monitor. Null until the shell has mounted
  // it; a replacement bar that hands widgets no services leaves it null.
  property var market: null

  function bindMarket() {
    if (market) return
    var host = bar && bar.shell ? bar.shell : null
    var service = host && typeof host.serviceFor === "function" ? host.serviceFor("bonavr.omafolio") : null
    if (!service) return
    market = service
    // After the bar has finished injecting this slot's settings.
    Qt.callLater(root.pushSettings)
  }

  function pushSettings() {
    if (market) market.settings = root.settings
  }

  onBarChanged: bindMarket()
  onSettingsChanged: pushSettings()

  // The service may be mounted after the widget.
  Timer {
    interval: 250
    running: root.market === null
    repeat: true
    onTriggered: root.bindMarket()
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.market ? Object.keys(root.market.quotes).length + " quotes" : "…"
    labelVisible: true
    hasVisualContent: true
    horizontalMargin: 8.75
  }
}
