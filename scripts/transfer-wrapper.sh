#!/bin/bash
set -e
SANDBOX="openshell-my-assistant"
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/bin"

# clawhub wrapper
printf '#!/bin/sh\nexec node /sandbox/node_modules/clawhub/bin/clawdhub.js "$@"\n' > "$TMPDIR/bin/clawhub"
chmod +x "$TMPDIR/bin/clawhub"

# claude wrapper
printf '#!/bin/sh\nexec node /sandbox/claude-pkg/node_modules/@anthropic-ai/claude-code/cli.js "$@"\n' > "$TMPDIR/bin/claude"
chmod +x "$TMPDIR/bin/claude"

# tar bundle (preserves +x)
cd "$TMPDIR"
tar czf /tmp/wrappers.tar.gz bin
base64 /tmp/wrappers.tar.gz | ssh "$SANDBOX" 'base64 -d > /sandbox/wrappers.tar.gz'
ssh "$SANDBOX" 'cd /sandbox && tar xzf wrappers.tar.gz'

echo "=== /sandbox/bin/ ==="
ssh "$SANDBOX" 'ls -la /sandbox/bin/'

echo "=== Test claude ==="
ssh "$SANDBOX" '/sandbox/bin/claude --version' 2>&1 | head -3 || echo "claude: failed"

echo "=== Test clawhub ==="
ssh "$SANDBOX" '/sandbox/bin/clawhub --cli-version' 2>&1 | tail -1 || echo "clawhub: failed"

echo "=== Skills ==="
ssh "$SANDBOX" 'PATH=/sandbox/bin:/usr/local/bin:/usr/bin:/bin openclaw skills list 2>&1 | grep -E "ready|Skills"'

rm -rf "$TMPDIR"
