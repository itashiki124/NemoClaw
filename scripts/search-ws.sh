#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_ROOT="${OPENCLAW_ROOT:-/usr/local/lib/node_modules/openclaw}"
DIST_DIR="$OPENCLAW_ROOT/dist"
DISCORD_PLUGIN="$DIST_DIR/plugin-sdk/discord.js"
NODE_MODULES_DIR="$OPENCLAW_ROOT/node_modules"
DISCORD_JS_DIR="$NODE_MODULES_DIR/discord.js"
WS_MODULE_DIR="$NODE_MODULES_DIR/ws"
WS_MODULE="$OPENCLAW_ROOT/node_modules/ws/lib/websocket.js"
MODE="${1:-1}"

print_section() {
	printf '=== %s ===\n' "$1"
}

run_grep() {
	local pattern="$1"
	local target="$2"
	local limit="$3"
	if [[ -f "$target" ]]; then
		grep -nE "$pattern" "$target" 2>/dev/null | head -n "$limit"
	fi
}

run_recursive_grep() {
	local pattern="$1"
	local target="$2"
	local limit="$3"
	if [[ -d "$target" ]]; then
		grep -rnE "$pattern" "$target" 2>/dev/null | head -n "$limit"
	fi
}

run_find() {
	local target="$1"
	local name_pattern="$2"
	local extra_args="$3"
	local limit="$4"
	if [[ -d "$target" ]]; then
		find "$target" -name "$name_pattern" $extra_args 2>/dev/null | head -n "$limit"
	fi
}

case "$MODE" in
	1)
		print_section "discord.js WebSocket markers"
		run_grep 'WebSocket|GatewayIntentBits|getaddrinfo|dns\.resolve|dns\.lookup|wss:' "$DISCORD_PLUGIN" 30
		print_section "WebSocket agent"
		run_grep 'agent|proxy|HttpsProxyAgent' "$DISCORD_PLUGIN" 20
		;;
	2)
		print_section "OpenClaw bundled files"
		run_find "$DIST_DIR" '*.js' '-size +100k' 10
		print_section "Gateway files"
		run_find "$DIST_DIR" '*gateway*' '' 20
		print_section "grep WebSocket in dist"
		if [[ -d "$DIST_DIR" ]]; then
			grep -rnl 'WebSocket' "$DIST_DIR" 2>/dev/null | head -n 20
		fi
		print_section "grep gateway.discord in dist"
		run_recursive_grep 'gateway.discord' "$DIST_DIR" 10
		print_section "grep ws agent/proxy in ws module"
		run_grep 'agent|proxy' "$WS_MODULE" 20
		;;
	3)
		print_section "search getaddrinfo in dist"
		run_grep 'getaddrinfo' "$DISCORD_PLUGIN" 5
		print_section "search WebSocket in discord.js plugin"
		run_grep 'WebSocket|new.*ws|\.ws\(' "$DISCORD_PLUGIN" 30
		print_section "search connect/login in discord.js plugin"
		run_grep 'connect|login|.client|Client\(' "$DISCORD_PLUGIN" 30
		print_section "wss in discord.js plugin"
		run_grep 'wss|ws://' "$DISCORD_PLUGIN" 20
		print_section "api/gateway in discord.js plugin"
		run_grep 'api/gateway|/gateway' "$DISCORD_PLUGIN" 20
		;;
	4)
		print_section "search discord gateway error pattern"
		run_grep 'gateway error|gateway.*WebSocket|gateway.*reconnect' "$DISCORD_PLUGIN" 20
		print_section "search at line 16875-17000"
		if [[ -f "$DISCORD_PLUGIN" ]]; then
			sed -n '16875,17000p' "$DISCORD_PLUGIN" 2>/dev/null
		fi
		;;
	5)
		SESSION_FILE="${SESSION_FILE:-$DIST_DIR/session-DcUt8Duu.js}"
		INDEX_FILE="${INDEX_FILE:-$DIST_DIR/index.js}"
		COMPACT_FILE="${COMPACT_FILE:-$DIST_DIR/compact-1mmJ_KWL.js}"
		print_section "session file WebSocket lines"
		run_grep 'WebSocket|gateway.discord|getGateway|gatewayURL|wss:' "$SESSION_FILE" 30
		print_section "index file Discord gateway"
		run_grep 'discord.*gateway|gateway.*discord|WebSocket.*discord|discord.*WebSocket' "$INDEX_FILE" 20
		print_section "compact file Discord gateway"
		run_grep 'discord.*gateway|gateway.*discord|WebSocket' "$COMPACT_FILE" 20
		print_section "all js files with WebSocket+discord"
		if [[ -d "$DIST_DIR" ]]; then
			grep -rlnE 'getGatewayBot|GatewayManager|DiscordGateway|startGateway|gateway.*discord' "$DIST_DIR" 2>/dev/null | head -n 10
		fi
		print_section "search for proxy/agent in WebSocket connect"
		run_grep 'HttpsProxyAgent|proxyAgent|proxy.*agent|agent.*proxy' "$DISCORD_PLUGIN" 10
		print_section "wc -l of discord.js plugin"
		if [[ -f "$DISCORD_PLUGIN" ]]; then
			wc -l "$DISCORD_PLUGIN" 2>/dev/null
		fi
		;;
	discord)
		print_section "discord.js package"
		if [[ -d "$DISCORD_JS_DIR/src" ]]; then
			find "$DISCORD_JS_DIR/src" -mindepth 1 -maxdepth 1 2>/dev/null | head -n 20
		fi
		print_section "@discordjs packages"
		if [[ -d "$NODE_MODULES_DIR/@discordjs" ]]; then
			find "$NODE_MODULES_DIR/@discordjs" -mindepth 1 -maxdepth 1 2>/dev/null
		fi
		print_section "discord.js version"
		if [[ -f "$DISCORD_JS_DIR/package.json" ]]; then
			grep -n '"version"' "$DISCORD_JS_DIR/package.json" 2>/dev/null | head -n 1
		fi
		print_section "WS pattern in discord.js"
		if [[ -d "$DISCORD_JS_DIR" ]]; then
			grep -rnl 'WebSocket' "$DISCORD_JS_DIR" 2>/dev/null | head -n 10
		fi
		print_section "ws module"
		if [[ -d "$WS_MODULE_DIR" ]]; then
			find "$WS_MODULE_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | head -n 10
		fi
		print_section "discord lookup in node_modules"
		if [[ -d "$NODE_MODULES_DIR" ]]; then
			find "$NODE_MODULES_DIR" -maxdepth 1 \( -name 'discord*' -o -name '@discordjs' \) 2>/dev/null | head -n 10
		fi
		;;
	create)
		COMPACT_FILE="${COMPACT_FILE:-$DIST_DIR/compact-1mmJ_KWL.js}"
		print_section "Search for client creation and ws/WebSocket in compact file"
		if [[ -f "$COMPACT_FILE" ]]; then
			grep -nE 'new.*Client|createGateway|WebSocket|gateway.*connect|\.connect\(' "$COMPACT_FILE" 2>/dev/null \
				| grep -ivE 'OpenAIWebSocket|VoiceWebSocket|browser|HTTP|ws\.readyState|ws\.close|ws\.send' \
				| head -n 30
		fi
		print_section "Search for proxy in compact file"
		if [[ -f "$COMPACT_FILE" ]]; then
			grep -nE 'proxy|ProxyAgent|createConnection|httpAgent' "$COMPACT_FILE" 2>/dev/null \
				| grep -iE 'discord|gateway|ws|WebSocket|agent' \
				| head -n 20
		fi
		print_section "ws import"
		run_grep 'from.*ws|require.*ws|import.*WebSocket' "$COMPACT_FILE" 20
		;;
	*)
		echo "Usage: $0 [1|2|3|4|5|discord|create]" >&2
		exit 1
		;;
esac
