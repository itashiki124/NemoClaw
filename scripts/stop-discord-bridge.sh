#!/usr/bin/env bash
set -euo pipefail

BRIDGE_DIR="${BRIDGE_DIR:-/tmp/discord-bot}"
PID_FILE="$BRIDGE_DIR/bot.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Discord bridge is not running"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Discord bridge stopped (PID $PID)"
else
  echo "Discord bridge pid file existed, but process was not running"
fi

rm -f "$PID_FILE"