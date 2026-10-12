#!/bin/sh
# Runs AtomicFile.qml and Fetcher.qml in a headless Quickshell and checks that
# what they handle (file text, request URLs) arrives intact and never appears
# on a command line, where any local user could read it from
# /proc/<pid>/cmdline. Local only: needs Quickshell (qs) and python3.
set -eu
cd "$(dirname "$0")/.."
plugin=$PWD
tmp=$(mktemp -d)
server=
trap '[ -n "$server" ] && kill "$server" 2>/dev/null; rm -rf "$tmp"' EXIT
# dash skips the EXIT trap on a signal unless the signal exits through it.
trap 'exit 130' INT TERM

marker="omafolio-private-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"

# File text with everything a shell or printf could mangle, past the 64 KiB a
# pipe holds at once.
python3 - "$tmp/expected.txt" "$marker" <<'PY'
import sys
path, marker = sys.argv[1], sys.argv[2]
line = marker + ' "quoted" \'single\' $1 $HOME `x` \\back\\slash %s %n é ₿\n'
open(path, "w", encoding="utf-8").write(line * 2400 + "no trailing newline")
PY

# Answers every GET with 200 and the request target as the body.
python3 - "$tmp/port" <<'PY' &
import http.server, sys
class Echo(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = self.path.encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
srv = http.server.HTTPServer(("127.0.0.1", 0), Echo)
open(sys.argv[1], "w").write(str(srv.server_address[1]))
srv.serve_forever()
PY
server=$!
i=0
while [ ! -s "$tmp/port" ]; do
  i=$((i + 1)); [ "$i" -gt 50 ] && { echo "echo server did not start"; exit 1; }
  sleep 0.1
done
port=$(cat "$tmp/port")

cat > "$tmp/shell.qml" <<QML
import QtQuick
import Quickshell
import Quickshell.Io
import "file://$plugin" as P

ShellRoot {
  id: root
  property string marker: "$marker"
  property string target: "$tmp/out/portfolio.json"
  // A literal quote, backslash and line break exercise curl config escaping;
  // the line break must arrive percent-encoded, not start a new option.
  property string path: "/q?m=" + marker + "&a=%22&b=\"&c=\\\\&d=x\nhttp://127.0.0.1:1/"
  property string expectedPath: "/q?m=" + marker + "&a=%22&b=\"&c=\\\\&d=x%0Ahttp://127.0.0.1:1/"
  property var pending: ["writer", "failedWriter", "fetcher"]

  function report(name, ok, detail) {
    console.log("RESULT " + (ok ? "PASS " : "FAIL ") + name + (detail ? ": " + detail : ""))
  }
  function settle(name) {
    pending = pending.filter(function(n) { return n !== name })
    if (pending.length === 0) Qt.quit()
  }
  function argsCarryMarker(command) {
    return command.join("\u0000").indexOf(marker) >= 0
  }

  FileView { id: expected; path: "$tmp/expected.txt"; blockLoading: true }

  P.AtomicFile {
    id: writer
    path: root.target
    property int landed: 0
    onWritten: function(ok, code) {
      landed++
      if (!ok) { root.report("writer", false, "write failed, exit " + code); root.settle("writer"); return }
      if (busy) return
      root.report("writer lands both queued writes", landed === 2, "landed " + landed)
      root.settle("writer")
    }
  }

  // mkdir under /proc fails, so sh exits without reading stdin.
  P.AtomicFile {
    id: failedWriter
    path: "/proc/omafolio-no-such-dir/x"
    onWritten: function(ok, code) {
      root.report("writer reports a failed write", !ok && code === 1, "ok " + ok + ", exit " + code)
      root.settle("failedWriter")
    }
  }

  P.Fetcher {
    id: fetcher
    onFinished: function(request, status, body) {
      root.report("fetcher answers", status === 200, "status " + status)
      root.report("fetcher sends the URL intact", body === root.expectedPath, "server saw " + body)
    }
    onFailed: function(request, reason) { root.report("fetcher answers", false, reason) }
    onDone: root.settle("fetcher")
  }

  Timer {
    interval: 20000
    running: true
    onTriggered: { root.report("finished in time", false, "still waiting for " + root.pending.join(", ")); Qt.quit() }
  }

  Component.onCompleted: {
    // The first write starts at once; the second queues behind it, and its
    // text, the whole expected file, is what must land.
    writer.write(root.marker + " first")
    root.report("writer arguments carry no text", !root.argsCarryMarker(writer.proc.command))
    writer.write(expected.text())
    failedWriter.write(root.marker)
    fetcher.fetch([{ url: "http://127.0.0.1:$port" + root.path }])
    root.report("fetcher arguments carry no URL", !root.argsCarryMarker(fetcher.proc.command))
  }
}
QML

# Proxies would route the request to 127.0.0.1 elsewhere.
out=$(env -u WAYLAND_DISPLAY -u http_proxy -u HTTP_PROXY -u all_proxy -u ALL_PROXY \
  QT_QPA_PLATFORM=offscreen timeout 60 qs -p "$tmp/shell.qml" 2>&1) || true
results=$(printf '%s\n' "$out" | sed -n 's/.*RESULT //p')
status=0
if [ -z "$results" ]; then
  echo "Quickshell reported nothing:"
  printf '%s\n' "$out" | tail -20
  exit 1
fi
printf '%s\n' "$results"
printf '%s\n' "$results" | grep -q '^FAIL' && status=1
[ "$(printf '%s\n' "$results" | grep -c '^PASS')" -eq 6 ] || { echo "expected 6 passes"; status=1; }

if cmp -s "$tmp/expected.txt" "$tmp/out/portfolio.json"; then
  echo "PASS written file matches the text byte for byte"
else
  echo "FAIL written file differs from the text"; status=1
fi
mode=$(stat -c %a "$tmp/out/portfolio.json" 2>/dev/null || echo none)
if [ "$mode" = 600 ]; then echo "PASS written file is mode 600"; else echo "FAIL written file mode is $mode"; status=1; fi
dirmode=$(stat -c %a "$tmp/out" 2>/dev/null || echo none)
if [ "$dirmode" = 700 ]; then echo "PASS new directory is mode 700"; else echo "FAIL new directory mode is $dirmode"; status=1; fi
leftovers=$(find "$tmp/out" -name '.omafolio.*' | wc -l)
if [ "$leftovers" -eq 0 ]; then echo "PASS no temporary files left"; else echo "FAIL $leftovers temporary files left"; status=1; fi

exit "$status"
