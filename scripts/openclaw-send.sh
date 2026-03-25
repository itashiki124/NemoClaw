#!/bin/bash
# OpenClaw CLI メッセージ送信スクリプト
source ~/.nvm/nvm.sh
MSG="$1"
SESSION="${2:-discord-bot}"
nemoclaw my-assistant connect -- openclaw agent --agent main --local -m "$MSG" --session-id "$SESSION"
