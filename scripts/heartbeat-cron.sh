#!/usr/bin/env bash
set -euo pipefail

# Heartbeat cron — 30分ごとに OpenClaw エージェントへ HEARTBEAT.md の指示を実行させる
# Usage:
#   crontab に登録:  */30 * * * * /path/to/heartbeat-cron.sh >> /tmp/heartbeat.log 2>&1
#   手動実行:        bash heartbeat-cron.sh
#   デーモン起動:    bash heartbeat-cron.sh --daemon

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INTERVAL_SECONDS=7200  # 2 hours
LOCKFILE="/tmp/heartbeat-cron.lock"
SESSION_ID="heartbeat"

source ~/.nvm/nvm.sh 2>/dev/null || true

send_heartbeat() {
  local prompt
  prompt='以下のコマンドを使って Discord チャンネルにメッセージを1つ送ってください。

【ルール】
- 日本語で書く
- 前回と絶対に違う話題にする
- 以下のカテゴリからランダムに選ぶ:
  1. 技術ネタ（プログラミング豆知識、面白いバグの話、アルゴリズムの雑学）
  2. 質問を投げかける（好きな言語は？最近ハマってることは？）
  3. 日本の文化・季節の話題
  4. 面白い雑学・トリビア
  5. ジョークやなぞなぞ
  6. おすすめ（本、映画、音楽、ゲーム）
  7. 今日は何の日
- 「桜」「天気」「散歩」は禁止（マンネリ防止）
- 嘘の体験談は禁止。AIとして話す

openclaw message send --channel discord --target 1484243496339767489 -m "<ここにメッセージ>"'

  ssh openshell-my-assistant \
    "openclaw agent --agent main --local --session-id ${SESSION_ID} -m $(printf '%q' "$prompt")" \
    2>&1 | tail -5

  echo "[$(date -Iseconds)] heartbeat sent"
}

run_daemon() {
  if [ -f "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE")" 2>/dev/null; then
    echo "Heartbeat daemon already running (pid $(cat "$LOCKFILE"))"
    exit 1
  fi

  echo $$ > "$LOCKFILE"
  trap 'rm -f "$LOCKFILE"' EXIT

  echo "[$(date -Iseconds)] heartbeat daemon started (interval=${INTERVAL_SECONDS}s)"

  while true; do
    send_heartbeat || echo "[$(date -Iseconds)] heartbeat failed"
    sleep "$INTERVAL_SECONDS"
  done
}

case "${1:-}" in
  --daemon)
    run_daemon
    ;;
  *)
    send_heartbeat
    ;;
esac
