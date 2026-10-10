import QtQuick
import qs.Commons
import qs.Ui

// Placeholder pill; replaced by the real widget when the data layer lands.
BarWidget {
  id: root
  moduleName: "bonavr.omafolio"
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "Omafolio"
    labelVisible: true
    hasVisualContent: true
    horizontalMargin: 8.75
  }
}
