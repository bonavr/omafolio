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

  MarketService {
    id: market
    settings: root.settings
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: Object.keys(market.quotes).length + " quotes"
    labelVisible: true
    hasVisualContent: true
    horizontalMargin: 8.75
  }
}
