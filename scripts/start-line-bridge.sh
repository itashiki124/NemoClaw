#!/usr/bin/env bash
set -euo pipefail

BRIDGE_DIR="${BRIDGE_DIR:-/tmp/line-bot}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$BRIDGE_DIR/bot.pid"
LOG_FILE="$BRIDGE_DIR/bot.log"
DAEMON_MODE="${1:-}"

# .env ファイルからトークンを読み込む
for envfile in "$SCRIPT_DIR/../.env" "$SCRIPT_DIR/.env"; do
  if [[ -f "$envfile" ]]; then
    set -a; source "$envfile"; set +a
    break
  fi
done

if [[ -z "${LINE_CHANNEL_SECRET:-}" ]]; then
  echo "LINE_CHANNEL_SECRET is required" >&2
  exit 1
fi
if [[ -z "${LINE_CHANNEL_ACCESS_TOKEN:-}" ]]; then
  echo "LINE_CHANNEL_ACCESS_TOKEN is required" >&2
  exit 1
fi

mkdir -p "$BRIDGE_DIR"

source ~/.nvm/nvm.sh

if [[ "$DAEMON_MODE" == "--daemon" ]]; then
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "LINE bridge is already running (PID $(cat "$PID_FILE"))"
    exit 0
  fi

  nohup node "$SCRIPT_DIR/line-bridge.js" >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "LINE bridge started (PID $(cat "$PID_FILE"))"
  echo "Log: $LOG_FILE"
  exit 0
fi

exec node "$SCRIPT_DIR/line-bridge.js"
