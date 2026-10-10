import QtQuick
import qs.Commons
import qs.Ui
import "lib/barframe.mjs" as BarFrame

// Rotating ticker pill: one item of the `bar` setting at a time (label, value,
// day move), with an `i/N` badge when there is more than one. Closed markets
// are dimmed with a sleep glyph, stale or excluded data adds a warning glyph
// and an explanatory tooltip. Left click toggles the panel, middle click
// refreshes, the wheel steps through the items, and hovering pauses rotation.
//
// Owns nothing but presentation: prices come from the shell's single
// MarketService, and what each frame says is decided by lib/barframe.mjs.
BarWidget {
  id: root
  moduleName: "bonavr.omafolio"
  implicitWidth: button.implicitWidth + (badge.visible ? badge.width + badgeGap : 0)
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

  // ---- Rotation

  readonly property var items: market ? market.config.bar : []
  readonly property int count: items.length
  // Position in `items` of the frame on show.
  property int index: 0
  readonly property int shown: count > 0 ? index % count : 0
  readonly property var frame: market && count > 0 ? BarFrame.barFrame(items[shown], {
    quotes: market.quotes,
    states: market.states,
    portfolio: market.portfolio,
    providerHealth: market.providerHealth
  }) : null

  // A wheel step holds the rotation still for this long, so the item the user
  // scrolled to can be read.
  readonly property int wheelPauseMs: 10000
  readonly property int badgeGap: 6
  // Wheel travel (angleDelta units) that makes one step; touchpads send many
  // small deltas which add up to it.
  readonly property int wheelNotch: 120
  property real wheelTravel: 0
  property bool wheelPaused: false
  readonly property bool hovered: hover.hovered

  function step(by) {
    if (count < 2) return
    index = (shown + by + count) % count
    rotation.restart()
    wheelPaused = true
    wheelResume.restart()
    // The tooltip describes the frame, which just changed.
    showFrameTooltip()
  }

  function onWheel(delta) {
    wheelTravel += delta
    while (Math.abs(wheelTravel) >= wheelNotch) {
      // Scrolling up goes back, like moving up a list.
      step(wheelTravel > 0 ? -1 : 1)
      wheelTravel -= wheelTravel > 0 ? wheelNotch : -wheelNotch
    }
  }

  Timer {
    id: rotation
    interval: root.market ? root.market.config.rotateSeconds * 1000 : 5000
    running: root.count > 1 && !root.hovered && !root.wheelPaused
    repeat: true
    onTriggered: root.index = (root.shown + 1) % root.count
  }

  Timer {
    id: wheelResume
    interval: root.wheelPauseMs
    onTriggered: root.wheelPaused = false
  }

  HoverHandler {
    id: hover
  }

  // ---- Tooltip

  // Replaces the frame's tooltip for a moment (the "updated Ns ago" reply to a
  // middle click that fetched nothing).
  property string notice: ""
  readonly property string tooltip: notice !== "" ? notice : (frame ? frame.tooltip : "")

  function showFrameTooltip() {
    if (bar && button.tooltipHovered) bar.showTooltip(button, root.tooltip)
  }

  Timer {
    id: noticeTimer
    interval: 3000
    onTriggered: {
      root.notice = ""
      if (root.bar) root.bar.hideTooltip(button)
      root.showFrameTooltip()
    }
  }

  // Middle click: fetch if a provider is due; otherwise say how fresh the data is.
  function refresh() {
    if (!market || market.refresh()) return
    var age = market.lastUpdated === null ? null : Math.max(0, Math.round((Date.now() - market.lastUpdated) / 1000))
    notice = age === null ? "not updated yet" : "updated " + age + "s ago"
    noticeTimer.restart()
    if (bar) bar.showTooltip(button, notice)
  }

  // ---- Panel contract (Bar.findPanelWidget needs open/close/opened on the root)

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
    if ("market" in target) target.market = root.market
  }

  function togglePanel() {
    if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
  }

  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item && panelLoader.item.openFromHotkey) panelLoader.item.openFromHotkey()
  }

  function close() {
    if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
  }

  // Forwarded so this widget can stand in for the panel as the bar's popout
  // identity: Bar.requestPopout prefers closeForPopoutSwitch over close, and
  // KeyboardPanel reads popoutSwitchClosing back off its owner.
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item && panelLoader.item.closeForPopoutSwitch) panelLoader.item.closeForPopoutSwitch()
  }

  // A local-plugin reload has the bar rebuild this widget and hand it the
  // settings its slot was mounted with. Settings written since (`omarchy bar
  // set`, the panel's settings page) were only patched into the bar's live
  // layout, so that is the fresher copy; adopt it once the bar has finished
  // injecting. Same values on a normal start, so this changes nothing there.
  function adoptBarSettings() {
    if (!root.bar || !root.bar.layoutConfig) return
    var layout = root.bar.layoutConfig
    var regions = ["left", "center", "right"]
    for (var r = 0; r < regions.length; r++) {
      var entries = layout[regions[r]] || []
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i]
        if (!e || typeof e !== "object" || String(e.id || "") !== root.moduleName) continue
        var fresh = {}
        for (var k in e) if (k !== "id") fresh[k] = e[k]
        var current = {}
        for (var c in root.settings) if (c !== "id") current[c] = root.settings[c]
        if (JSON.stringify(fresh) !== JSON.stringify(current)) root.settings = fresh
        return
      }
    }
  }

  onBarChanged: {
    bindMarket()
    injectPanel()
    Qt.callLater(adoptBarSettings)
  }
  onSettingsChanged: {
    pushSettings()
    injectPanel()
  }
  onMarketChanged: injectPanel()

  // The service may be mounted after the widget.
  Timer {
    interval: 250
    running: root.market === null
    repeat: true
    onTriggered: root.bindMarket()
  }

  // Inactive until the panel exists; then Panel.qml is loaded and handed
  // bar, settings, anchorItem, hostWidget and market.
  Loader {
    id: panelLoader
    active: false
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  // ---- Drawing

  readonly property bool dimmed: frame !== null && frame.state === "closed"

  ThemeColors {
    id: themeColors
  }

  function pillText() {
    if (!frame) return "…"
    var parts = [frame.label, frame.value]
    if (frame.change !== "") parts.push(frame.change)
    if (frame.state === "closed") parts.push("󰒲")
    if (frame.warn) parts.push("⚠")
    return parts.join(" ")
  }

  function escapeStyled(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }

  // The same text as pillText, with the day move in the theme's green or red
  // (closed frames stay entirely muted, flat moves keep the normal colour).
  function pillStyledText() {
    if (!frame) return "…"
    var plain = pillText()
    if (frame.change === "" || dimmed || frame.direction === "flat") return escapeStyled(plain)
    var color = frame.direction === "up" ? themeColors.up : themeColors.down
    var at = plain.indexOf(frame.change)
    return escapeStyled(plain.substring(0, at)) + "<font color=\"" + color + "\">" + escapeStyled(frame.change)
      + "</font>" + escapeStyled(plain.substring(at + frame.change.length))
  }

  WidgetButton {
    id: button
    anchors.left: parent.left
    anchors.top: parent.top
    anchors.bottom: parent.bottom
    bar: root.bar
    text: root.pillText()
    foreground: root.dimmed ? Color.muted : (root.bar ? root.bar.barForeground : Color.foreground)
    // Sizes the pill; the coloured copy below is what is drawn.
    labelVisible: false
    hasVisualContent: true
    horizontalMargin: 8.75
    tooltipText: root.tooltip

    Text {
      anchors.centerIn: parent
      textFormat: Text.StyledText
      text: root.pillStyledText()
      color: button.foreground
      font.family: button.fontFamily
      font.pixelSize: button.fontSize
      renderType: Text.NativeRendering
    }

    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.refresh()
      else root.togglePanel()
    }
    onWheelMoved: function(delta) { root.onWheel(delta) }
  }

  Rectangle {
    id: badge
    visible: root.count > 1
    anchors.verticalCenter: parent.verticalCenter
    anchors.left: button.right
    anchors.leftMargin: -Style.spaceReal(8.75) + root.badgeGap
    width: badgeLabel.implicitWidth + Style.spaceReal(8)
    height: badgeLabel.implicitHeight + Style.spaceReal(2)
    radius: Math.min(Style.cornerRadius, height / 2) || 3
    color: Color.muted

    Text {
      id: badgeLabel
      anchors.centerIn: parent
      textFormat: Text.PlainText
      text: (root.shown + 1) + "/" + root.count
      color: Color.background
      font.family: button.fontFamily
      font.pixelSize: Style.font.bodySmall
      renderType: Text.NativeRendering
    }

    MouseArea {
      anchors.fill: parent
      acceptedButtons: Qt.LeftButton | Qt.MiddleButton
      onClicked: function(mouse) { button.triggerPress(mouse.button) }
      onWheel: function(wheel) { root.onWheel(wheel.angleDelta.y) }
    }
  }
}
