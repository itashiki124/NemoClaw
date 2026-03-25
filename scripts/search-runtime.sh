#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_ROOT="${OPENCLAW_ROOT:-/usr/local/lib/node_modules/openclaw}"
DIST_DIR="$OPENCLAW_ROOT/dist"
DISCORD_PLUGIN="$DIST_DIR/plugin-sdk/discord.js"
COMPACT_FILE="${COMPACT_FILE:-$DIST_DIR/compact-1mmJ_KWL.js}"
MODE="${1:-proxy}"

print_section() {
  printf '=== %s ===\n' "$1"
}

show_lines() {
  local file="$1"
  local range="$2"
  if [[ -f "$file" ]]; then
    sed -n "$range" "$file" 2>/dev/null
  fi
}

search_file() {
  local pattern="$1"
  local file="$2"
  local limit="$3"
  if [[ -f "$file" ]]; then
    grep -nE "$pattern" "$file" 2>/dev/null | head -n "$limit"
  fi
}

search_tree() {
  local pattern="$1"
  local dir="$2"
  local limit="$3"
  if [[ -d "$dir" ]]; then
    grep -rnE "$pattern" "$dir" 2>/dev/null | head -n "$limit"
  fi
}

case "$MODE" in
  proxy)
    print_section "proxy config in discord plugin"
    show_lines "$DISCORD_PLUGIN" '790,810p'
    print_section "search for proxy usage"
    search_file 'proxy' "$DISCORD_PLUGIN" 30
    print_section "Lines 13560-13600"
    show_lines "$DISCORD_PLUGIN" '13560,13600p'
    print_section "Lines 13750-13800"
    show_lines "$DISCORD_PLUGIN" '13750,13800p'
    print_section "search for proxy usage in connect/ws code"
    if [[ -f "$DISCORD_PLUGIN" ]]; then
      grep -nE 'proxy|ProxyAgent|createConnection|httpAgent|wsOptions|rest.*proxy' "$DISCORD_PLUGIN" 2>/dev/null \
        | grep -ivE 'loopback|trusted' \
        | head -n 40
    fi
    print_section "search proxy in lines 14000-15500"
    if [[ -f "$DISCORD_PLUGIN" ]]; then
      grep -n 'proxy' "$DISCORD_PLUGIN" 2>/dev/null | awk -F: '$1 >= 14000 && $1 <= 15500'
    fi
    print_section "proxy in lines near startProvider"
    search_file 'startProvider|startGateway|createClient|GatewayClient' "$DISCORD_PLUGIN" 20
    ;;
  gateway)
    print_section "Lines around 76650-76720 (gateway error)"
    show_lines "$COMPACT_FILE" '76650,76720p'
    print_section "Lines around 77230-77270 (logged in)"
    show_lines "$COMPACT_FILE" '77230,77270p'
    ;;
  startup)
    print_section "starting provider log message"
    search_tree 'starting provider' "$DIST_DIR" 5
    print_section "gateway error log message"
    search_tree 'gateway error' "$DIST_DIR" 5
    print_section "logged in to discord"
    search_tree 'logged in to discord' "$DIST_DIR" 5
    ;;
  *)
    echo "Usage: $0 [proxy|gateway|startup]" >&2
    exit 1
    ;;
esac