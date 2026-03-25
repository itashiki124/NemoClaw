#!/usr/bin/env bash
set -euo pipefail

BRIDGE_DIR="${BRIDGE_DIR:-/tmp/discord-bot}"
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

if [[ -z "${DISCORD_TOKEN:-}" ]]; then
  echo "DISCORD_TOKEN is required" >&2
  exit 1
fi

mkdir -p "$BRIDGE_DIR"
cp "$SCRIPT_DIR/discord-bridge-bot.py" "$BRIDGE_DIR/bot.py"

cd "$BRIDGE_DIR"

if [[ ! -d venv ]]; then
  python3 -m venv venv
fi

source venv/bin/activate
python3 -m pip install -q --disable-pip-version-check discord.py

source ~/.nvm/nvm.sh

if [[ "$DAEMON_MODE" == "--daemon" ]]; then
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Discord bridge is already running (PID $(cat "$PID_FILE"))"
    exit 0
  fi

  nohup python3 bot.py >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "Discord bridge started (PID $(cat "$PID_FILE"))"
  exit 0
fi

exec python3 bot.py