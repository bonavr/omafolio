import QtQuick
import qs.Commons
import qs.Ui
import "lib/keyfield.mjs" as Line

// A one-line text field, drawn from plain Text and styled like the shell's
// TextField. Qt's editable TextInput (inside TextField, SpinBox and the shell's
// NumberField) reads the whole clipboard every time it changes, with no size
// limit or deadline, so another program could stall the shell through any
// such field that exists, shown or not. This one never touches the clipboard
// and offers no paste.
//
// lib/keyfield.mjs decides what each key does. Keys it leaves alone (Enter,
// Esc, Tab, Up, Down) reach this item's own Keys handlers, then its parents.
// A read-only field does not take the keyboard. Input methods are not
// supported: characters arrive as the keyboard layout types them.
FocusScope {
  id: field

  property string text: ""
  property string placeholderText: ""
  property bool readOnly: false
  // Text.AlignLeft, AlignRight or AlignHCenter, while the text fits.
  property int horizontalAlignment: Text.AlignLeft
  // Matches each character that may be typed (a RegExp); null allows any.
  property var allowed: null
  property color foreground: Color.foreground
  property color accent: Color.accent
  property font font: Qt.font({ family: Style.font.family, pixelSize: Style.font.body })
  property real horizontalPadding: Style.spacing.controlPaddingX
  property real verticalPadding: Style.spacing.inputPaddingY
  property real leftPadding: horizontalPadding + Border.left(borderSpec)
  property real rightPadding: horizontalPadding + Border.right(borderSpec)
  readonly property var borderSpec: Border.controlSpec(activeFocus ? "focus" : (hover.hovered ? "hover-cursor" : "normal"), foreground, accent)

  // Where typing goes (0 to text.length), and whether all the text is
  // selected. Setting `text` from outside puts the cursor at the end.
  property int cursor: text.length
  property bool all: false

  // Typing changed the text; setting `text` does not emit this.
  signal textEdited()
  // The field lost the keyboard.
  signal editingFinished()

  function selectAll() {
    cursor = text.length
    all = text !== ""
  }

  // Applies a Line from lib/keyfield.mjs.
  function apply(next) {
    var edited = next.text !== text
    typing = true
    text = next.text
    typing = false
    cursor = next.cursor
    all = next.all
    blink.show()
    if (edited) textEdited()
  }

  // Handles one key press: true when this field used it. Keys.onPressed below
  // calls it; tests call it directly.
  function key(code, typed, modifiers) {
    if (readOnly) return false
    var next = Line.press({ text: text, cursor: cursor, all: all }, code, typed, modifiers, allowed)
    if (!next) return false
    apply(next)
    return true
  }

  property bool typing: false
  onTextChanged: if (!typing) { cursor = text.length; all = false }
  onActiveFocusChanged: if (!activeFocus) { all = false; editingFinished() }

  activeFocusOnTab: !readOnly
  implicitWidth: leftPadding + rightPadding + Style.space(120)
  implicitHeight: Math.ceil(metrics.height) + 2 * verticalPadding + Border.top(borderSpec) + Border.bottom(borderSpec)

  Accessible.role: Accessible.EditableText
  Accessible.name: placeholderText
  Accessible.readOnly: readOnly

  FontMetrics { id: metrics; font: field.font }
  HoverHandler { id: hover; cursorShape: field.readOnly ? Qt.ArrowCursor : Qt.IBeamCursor }

  BorderSurface {
    anchors.fill: parent
    color: Style.controlFill(field.activeFocus, hover.hovered, field.foreground, field.accent)
    borderSpec: field.borderSpec
    radius: Style.cornerRadius
  }

  Item {
    id: editor
    focus: true
    Keys.onPressed: function(event) { if (field.key(event.key, event.text, event.modifiers)) event.accepted = true }
  }

  Item {
    id: viewport
    anchors.fill: parent
    anchors.leftMargin: field.leftPadding
    anchors.rightMargin: field.rightPadding
    clip: true

    readonly property real textWidth: metrics.advanceWidth(field.text)
    readonly property real cursorX: metrics.advanceWidth(field.text.slice(0, field.cursor))
    // The width text may use: the last pixel is kept for the cursor after it.
    readonly property real room: width - 1
    // How far overflowing text is scrolled left so the cursor shows.
    property real scroll: 0
    readonly property real textX: textWidth > room ? -scroll
      : field.horizontalAlignment === Text.AlignRight ? room - textWidth
      : field.horizontalAlignment === Text.AlignHCenter ? (room - textWidth) / 2
      : 0

    function follow() {
      if (textWidth <= room) { scroll = 0; return }
      var s = Math.min(scroll, textWidth - room)
      if (cursorX < s) s = cursorX
      else if (cursorX > s + room) s = cursorX - room
      scroll = Math.max(0, s)
    }
    onCursorXChanged: follow()
    onTextWidthChanged: follow()
    onWidthChanged: follow()

    Rectangle {
      visible: field.all
      x: viewport.textX
      anchors.verticalCenter: parent.verticalCenter
      width: viewport.textWidth
      height: metrics.height
      color: Style.selectionFillFor(field.foreground, field.accent)
    }

    Text {
      x: viewport.textX
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: field.text
      color: field.foreground
      font: field.font
    }

    Text {
      visible: field.text === ""
      width: parent.width
      anchors.verticalCenter: parent.verticalCenter
      horizontalAlignment: field.horizontalAlignment
      textFormat: Text.PlainText
      text: field.placeholderText
      color: Qt.darker(field.foreground, 1.6)
      font: field.font
      elide: Text.ElideRight
    }

    Rectangle {
      visible: field.activeFocus && !field.all && blink.on
      x: Math.min(Math.round(viewport.textX + viewport.cursorX), Math.floor(viewport.width) - 1)
      anchors.verticalCenter: parent.verticalCenter
      width: 1
      height: metrics.height
      color: field.foreground
    }
  }

  // Shows the cursor at once after a key or click, then blinks it.
  Timer {
    id: blink
    property bool on: true
    function show() { on = true; restart() }
    interval: 530
    repeat: true
    running: field.activeFocus
    onTriggered: on = !on
    onRunningChanged: on = true
  }

  // A click puts the cursor at the nearest character; a double click selects
  // everything.
  MouseArea {
    anchors.fill: parent
    enabled: !field.readOnly
    cursorShape: Qt.IBeamCursor
    onPressed: function(mouse) {
      field.forceActiveFocus()
      var offsets = []
      for (var i = 0; i <= field.text.length; i++) offsets.push(metrics.advanceWidth(field.text.slice(0, i)))
      field.cursor = Line.positionAt(field.text, offsets, mouse.x - viewport.x - viewport.textX)
      field.all = false
      blink.show()
    }
    onDoubleClicked: field.selectAll()
  }
}
