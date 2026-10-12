import QtQuick
import Quickshell.Io

// Replaces a file's contents atomically: mktemp (mode 600, unpredictable
// name) in the target's directory, write, then rename over the target, so a
// crash never leaves a partial file and a planted symlink is replaced, not
// written through. Writes queue: while one runs, the latest text waits.
// The text reaches sh on stdin, never as an argument: any local user can read
// a process's arguments from /proc/<pid>/cmdline while it runs.
// Pattern from Omacoins' Panel.qml (MIT, Bernard Costa).
QtObject {
  id: writer

  required property string path
  // Whether a write is running or waiting.
  readonly property bool busy: writing || hasPending || landing
  property string pending: ""
  property bool hasPending: false
  // The text of the write in progress, handed to sh once it has started.
  property string inFlight: ""
  // From starting sh until it exits or fails to start. Kept by hand because
  // proc.running's change notification lags its value by an event-loop turn.
  property bool writing: false
  property bool landing: false
  property int lastCode: 0

  // Emitted after each write. `ok` is false when it failed (the file is then
  // unchanged); `code` is sh's exit code, -1 when it crashed or did not start.
  signal written(bool ok, int code)

  function write(text) {
    pending = text
    hasPending = true
    flush()
  }

  function flush() {
    if (writing || landing || !hasPending) return
    inFlight = pending
    pending = ""
    hasPending = false
    // The path travels as an argument, never inside the script.
    proc.command = ["sh", "-c",
      'umask 077; d=$(dirname -- "$0") && mkdir -p -- "$d" && t=$(mktemp -- "$d/.omafolio.XXXXXX") || exit 1; '
      + 'cat > "$t" && mv -f -- "$t" "$0" || { rm -f -- "$t"; exit 1; }',
      writer.path]
    proc.stdinEnabled = true
    writing = true
    proc.running = true
  }

  function land(code) {
    writing = false
    inFlight = ""
    lastCode = code
    landing = true
    after.restart()
  }

  readonly property Process proc: Process {
    // Turning stdin off closes it, so cat sees the end of the text.
    onStarted: {
      writer.proc.write(writer.inFlight)
      writer.proc.stdinEnabled = false
    }
    onExited: function(code, exitStatus) { writer.land(exitStatus === 0 ? code : -1) }
    // A process that fails to start (sh missing) never reports exited, only
    // running turning false; that is a failed write. After a real exit,
    // `writing` is already false by the time running changes.
    onRunningChanged: if (!running && writer.writing) writer.land(-1)
  }

  // Reports and starts the next write outside Process's own signal handler.
  readonly property Timer after: Timer {
    interval: 0
    onTriggered: {
      writer.landing = false
      writer.flush()
      writer.written(writer.lastCode === 0, writer.lastCode)
    }
  }
}
