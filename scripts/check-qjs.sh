#!/bin/sh
# Loads every lib/ module in Qt's QML engine (the one omarchy-shell runs), which
# lacks some syntax Node accepts (object spread/rest, `catch {`). Local only:
# needs qml6 from Qt 6.
set -eu
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
status=0
for module in $(find lib -name '*.mjs' | sort); do
  cat > "$tmp/check.qml" <<QML
import QtQml
import "file://$PWD/$module" as M
QtObject { Component.onCompleted: Qt.quit() }
QML
  if ! out=$(QT_QPA_PLATFORM=offscreen QT_FORCE_STDERR_LOGGING=1 qml6 "$tmp/check.qml" 2>&1); then
    echo "$module does not load in QJSEngine:"
    echo "$out" | grep -v 'Did not load any objects'
    status=1
  fi
done
[ "$status" -eq 0 ] && echo "All lib modules load in QJSEngine."
exit "$status"
