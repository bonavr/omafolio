import QtQuick
import QtQuick.Shapes
import "lib/panel.mjs" as PanelLib

// A price series drawn as a line filling the item, lowest value at the bottom and
// highest at the top, points evenly spaced. With `filled` the area under the line
// is tinted in the same colour. Nothing is drawn for fewer than two points.
Item {
  id: root

  // Array<[epochMs, value]>, oldest first (a lib/types.mjs Series' points).
  property var points: []
  // Line colour; the fill is this at low opacity. Callers pick it from the series'
  // direction (lib/panel.mjs seriesDirection).
  property color color: "transparent"
  property bool filled: false
  property real lineWidth: 1.3

  // Room kept above and below the line so a peak or trough is not cut by the edge.
  readonly property real pad: Math.ceil(lineWidth)
  readonly property var line: PanelLib.chartPoints(points, width, height, pad).map(function(p) { return Qt.point(p[0], p[1]) })
  // The line closed along the bottom edge.
  readonly property var area: filled && line.length > 0 ? line.concat([Qt.point(width, height), Qt.point(0, height)]) : []

  Shape {
    anchors.fill: parent
    preferredRendererType: Shape.CurveRenderer

    ShapePath {
      strokeColor: "transparent"
      strokeWidth: 0
      fillColor: Qt.rgba(root.color.r, root.color.g, root.color.b, 0.13)
      PathPolyline { path: root.area }
    }

    ShapePath {
      strokeColor: root.color
      strokeWidth: root.lineWidth
      fillColor: "transparent"
      joinStyle: ShapePath.RoundJoin
      capStyle: ShapePath.RoundCap
      PathPolyline { path: root.line }
    }
  }
}
