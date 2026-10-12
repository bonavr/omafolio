import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "lib/theme.mjs" as Theme

// The active theme's green and red, which the shell's Color singleton does not
// carry. `up` and `down` follow the theme (they update when it is switched) and
// are Color.foreground for a theme that lacks the key. Declare one wherever
// movement colours are drawn.
QtObject {
  id: root

  property color up: Color.foreground
  property color down: Color.foreground

  function adopt(text) {
    var parsed = Theme.parseThemeColors(text)
    up = parsed.up !== null ? parsed.up : Color.foreground
    down = parsed.down !== null ? parsed.down : Color.foreground
  }

  // colors.toml sits behind the current-theme symlink, which a plain file watch
  // misses when the symlink retargets. A theme switch pushes the new palette
  // into Color, so its changes are the reliable cue to re-read the file.
  readonly property FileView file: FileView {
    path: Quickshell.env("HOME") + "/.local/state/omarchy/current/theme/colors.toml"
    printErrors: false
    onLoaded: root.adopt(text())
    onLoadFailed: root.adopt("")
  }

  readonly property Connections themeChanges: Connections {
    target: Color
    function onForegroundChanged() { root.file.reload() }
    function onBackgroundChanged() { root.file.reload() }
    function onAccentChanged() { root.file.reload() }
    function onUrgentChanged() { root.file.reload() }
  }
}
