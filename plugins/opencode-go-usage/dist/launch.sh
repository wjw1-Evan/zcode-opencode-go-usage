#!/bin/sh
# Locate a Node.js >= 18 interpreter and start the plugin's MCP server.
# The path below is derived from this script's own location; it never guesses
# the ZCode install cache path.
set -u
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENTRY="$DIR/server.mjs"

run_node() {
  [ -n "${1:-}" ] && [ -x "$1" ] && exec "$1" "$ENTRY"
}

run_node "${ZCODE_NODE:-}"
if command -v node >/dev/null 2>&1; then
  exec node "$ENTRY"
fi
run_node /opt/homebrew/bin/node
run_node /usr/local/bin/node
run_node "$HOME/.volta/bin/node"
for candidate in "$HOME"/.nvm/versions/node/*/bin/node; do
  [ -x "$candidate" ] && exec "$candidate" "$ENTRY"
done

# Last resort: the Electron helper bundled with ZCode Desktop, used the same
# way official plugins launch their MCP servers.
ZCODE_CJS="/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs"
ZCODE_HELPER="/Applications/ZCode.app/Contents/Frameworks/ZCode Helper.app/Contents/MacOS/ZCode Helper"
if [ -x "$ZCODE_HELPER" ] && [ -f "$ZCODE_CJS" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$ZCODE_HELPER" "$ZCODE_CJS" __zcode-plugin-host "$ENTRY"
fi

echo "opencode-go-usage: Node.js 18+ not found. Install Node.js or set ZCODE_NODE to a node binary." >&2
exit 127
