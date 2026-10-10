import QtQuick
import Quickshell.Io

// Runs provider Requests (lib/types.mjs) through curl, one at a time, and hands
// back each raw answer. It knows nothing about providers or parsing.
//
// The fetch discipline is adapted from Omacoins' MarketsFeed.qml
// (https://github.com/bernardcosta/omarchy-omacoins, MIT, Copyright (c) 2026
// Bernard Costa):
// - A job is a list of Requests run in order. finished() or failed() fires once
//   per request, then done() once for the job.
// - Never more than one request in flight. fetch() during a job queues exactly
//   one more job, carrying the latest parameters (a later fetch() replaces the
//   queued one). A queued job identical to the one just completed is dropped:
//   its answer is already the freshest there is.
// - Every request has a 15 s timeout and a 2 MiB body cap, and sends a generic
//   user agent and no cookies. curl runs with -q, so ~/.curlrc cannot add
//   cookies, headers or options that change what comes back.
// - A curl that cannot be started counts as a failed request, so done() always
//   follows.
QtObject {
  id: fetcher

  // A request got an HTTP answer. `status` is the HTTP status, whatever it is;
  // judging it is the caller's job.
  signal finished(var request, int status, string body)
  // A request got no HTTP answer: network error, timeout, body over the cap.
  // `reason` is for logs.
  signal failed(var request, string reason)
  // The last request of a job has been answered. A queued job starts right
  // after this, so a handler that calls fetch() runs before it.
  signal done()

  // True from fetch() until the job's done(); a caller that only fetches while
  // this is false gets plain first-in, first-out behaviour.
  readonly property bool busy: job.length > 0

  // The job being run, the index of the request in flight, and the queued job.
  property var job: []
  property int index: 0
  property var queued: null
  // A request is answered once curl has exited and its stdout has been read,
  // which Quickshell may report in either order.
  property bool exitSeen: false
  property bool stdoutSeen: false
  property int exitCode: 0

  // Starts `requests` (Request[]), or queues them while a job runs. An empty
  // list does nothing.
  function fetch(requests) {
    if (!requests || requests.length === 0) return
    if (busy) {
      queued = requests
      return
    }
    index = 0
    job = requests
    runCurrent()
  }

  function runCurrent() {
    exitSeen = false
    stdoutSeen = false
    // -q must come first: it stops curl reading ~/.curlrc.
    proc.command = ["curl", "-q", "-sS", "--max-time", "15", "--max-filesize", "2097152",
      "-A", "Mozilla/5.0", "-w", "\n%{http_code}", job[index].url]
    proc.running = true
  }

  function answer() {
    if (!exitSeen || !stdoutSeen) return
    var request = job[index]
    var out = String(proc.stdout.text)
    // curl's -w puts the HTTP status on a line of its own after the body.
    var cut = out.lastIndexOf("\n")
    var status = cut < 0 ? NaN : Number(out.slice(cut + 1))
    if (exitCode !== 0) fetcher.failed(request, "curl exit " + exitCode + ": " + String(proc.stderr.text).trim())
    else if (!(status >= 100 && status <= 599)) fetcher.failed(request, "no HTTP status in curl output")
    else fetcher.finished(request, status, out.slice(0, cut))
    // The next request starts outside Process's own signal handlers.
    advance.restart()
  }

  function next() {
    if (index + 1 < job.length) {
      index++
      runCurrent()
      return
    }
    var completed = job
    var pending = queued
    queued = null
    job = []
    fetcher.done()
    if (pending && !sameUrls(pending, completed)) fetch(pending)
  }

  function sameUrls(a, b) {
    return a.length === b.length && a.every(function(r, i) { return r.url === b[i].url })
  }

  readonly property Timer advance: Timer {
    interval: 0
    onTriggered: fetcher.next()
  }

  readonly property Process proc: Process {
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        fetcher.stdoutSeen = true
        fetcher.answer()
      }
    }
    stderr: StdioCollector { waitForEnd: true }
    onExited: function(code, exitStatus) {
      // A crashed or killed curl counts as a failure even if it reports code 0.
      fetcher.exitCode = exitStatus === 0 ? code : -1
      fetcher.exitSeen = true
      fetcher.answer()
    }
    // A curl that fails to start (not installed) reports neither exited nor
    // its stdout, only running turning false; answer it as a failed exit.
    // After a real exit this arrives with exitSeen already set.
    onRunningChanged: {
      if (running || fetcher.exitSeen || !fetcher.busy) return
      fetcher.exitCode = -1
      fetcher.exitSeen = true
      fetcher.stdoutSeen = true
      fetcher.answer()
    }
  }
}
