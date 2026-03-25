#!/usr/bin/env bash
# Install CLI tools into sandbox via tar transfer (preserves permissions)
set -euo pipefail

SANDBOX="openshell-my-assistant"
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT
mkdir -p "$TMPDIR/bin"

echo "=== Step 1: Install npm packages on WSL host ==="

# Claude Code
echo "  Installing Claude Code..."
cd /tmp
if [ ! -d install-claude/node_modules ]; then
  rm -rf install-claude; mkdir install-claude; cd install-claude
  npm install @anthropic-ai/claude-code 2>/dev/null
fi
cd /tmp/install-claude; tar czf /tmp/claude-nm.tar.gz node_modules
echo "  Claude Code: $(du -h /tmp/claude-nm.tar.gz | cut -f1)"

# Summarize
echo "  Installing summarize..."
cd /tmp
if [ ! -d install-summarize/node_modules ]; then
  rm -rf install-summarize; mkdir install-summarize; cd install-summarize
  npm install @steipete/summarize 2>/dev/null
fi
cd /tmp/install-summarize; tar czf /tmp/summarize-nm.tar.gz node_modules
echo "  summarize: $(du -h /tmp/summarize-nm.tar.gz | cut -f1)"

# Oracle
echo "  Installing oracle..."
cd /tmp
if [ ! -d install-oracle/node_modules ]; then
  rm -rf install-oracle; mkdir install-oracle; cd install-oracle
  npm install @steipete/oracle 2>/dev/null
fi
cd /tmp/install-oracle; tar czf /tmp/oracle-nm.tar.gz node_modules
echo "  oracle: $(du -h /tmp/oracle-nm.tar.gz | cut -f1)"

echo "=== Step 2: Build wrapper scripts ==="

# claude wrapper
printf '#!/bin/sh\nexec node /sandbox/claude-pkg/node_modules/@anthropic-ai/claude-code/cli.js "$@"\n' > "$TMPDIR/bin/claude"
chmod +x "$TMPDIR/bin/claude"

# summarize wrapper  
SUMM_JS=$(cat /tmp/install-summarize/node_modules/.bin/summarize 2>/dev/null | grep 'exec node' | head -1 | sed 's/.*exec node *//;s/ .*//')
if [ -z "$SUMM_JS" ]; then SUMM_JS="../@steipete/summarize/bin/cli.js"; fi
printf '#!/bin/sh\nexec node /sandbox/summarize-pkg/node_modules/.bin/%s "$@"\n' "$SUMM_JS" > "$TMPDIR/bin/summarize"
chmod +x "$TMPDIR/bin/summarize"

# oracle wrapper
ORA_JS=$(cat /tmp/install-oracle/node_modules/.bin/oracle 2>/dev/null | grep 'exec node' | head -1 | sed 's/.*exec node *//;s/ .*//')
if [ -z "$ORA_JS" ]; then ORA_JS="../@steipete/oracle/bin/cli.js"; fi
printf '#!/bin/sh\nexec node /sandbox/oracle-pkg/node_modules/.bin/%s "$@"\n' "$ORA_JS" > "$TMPDIR/bin/oracle"
chmod +x "$TMPDIR/bin/oracle"

echo "=== Step 3: Create tools bundle ==="
cd "$TMPDIR"
tar czf /tmp/tools-bundle.tar.gz bin
echo "  Tools bundle: $(du -h /tmp/tools-bundle.tar.gz | cut -f1)"

echo "=== Step 4: Transfer to sandbox ==="

# Tools bundle (wrappers + tmux etc.)
echo "  Transferring tools bundle..."
base64 /tmp/tools-bundle.tar.gz | ssh "$SANDBOX" 'base64 -d > /sandbox/tools-bundle.tar.gz'
ssh "$SANDBOX" 'cd /sandbox && tar xzf tools-bundle.tar.gz'

# Claude Code node_modules
echo "  Transferring Claude Code (28MB)..."
ssh "$SANDBOX" 'mkdir -p /sandbox/claude-pkg'
base64 /tmp/claude-nm.tar.gz | ssh "$SANDBOX" 'base64 -d > /sandbox/claude-pkg/nm.tar.gz'
ssh "$SANDBOX" 'cd /sandbox/claude-pkg && tar xzf nm.tar.gz'
echo "  Claude Code: transferred"

# Summarize node_modules
echo "  Transferring summarize..."
ssh "$SANDBOX" 'mkdir -p /sandbox/summarize-pkg'
base64 /tmp/summarize-nm.tar.gz | ssh "$SANDBOX" 'base64 -d > /sandbox/summarize-pkg/nm.tar.gz'
ssh "$SANDBOX" 'cd /sandbox/summarize-pkg && tar xzf nm.tar.gz'
echo "  summarize: transferred"

# Oracle node_modules
echo "  Transferring oracle..."
ssh "$SANDBOX" 'mkdir -p /sandbox/oracle-pkg'
base64 /tmp/oracle-nm.tar.gz | ssh "$SANDBOX" 'base64 -d > /sandbox/oracle-pkg/nm.tar.gz'
ssh "$SANDBOX" 'cd /sandbox/oracle-pkg && tar xzf nm.tar.gz'
echo "  oracle: transferred"

echo "=== Step 5: Verify ==="
ssh "$SANDBOX" 'ls -la /sandbox/bin/'
ssh "$SANDBOX" 'PATH=/sandbox/bin:/usr/local/bin:/usr/bin:/bin openclaw skills list 2>&1 | grep -E "ready|Skills"'
echo "=== Complete ==="
