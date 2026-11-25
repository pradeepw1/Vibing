#!/usr/bin/env bash
# Builds Buddy and puts it in your Applications folder.
# Run it from Terminal:  ./install.sh

set -euo pipefail
cd "$(dirname "$0")"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This installer is for Macs. On other computers, run: npm install && npm start"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Buddy needs Node.js to build (it's free)."
  echo "Opening nodejs.org. Download the LTS version, install it, then run ./install.sh again."
  open "https://nodejs.org/en/download" || true
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if (( NODE_MAJOR < 20 )); then
  echo "Your Node.js is too old ($(node -v)). Install the LTS version from https://nodejs.org and try again."
  exit 1
fi

echo "→ Getting everything Buddy needs (the first time takes a few minutes)…"
npm install --no-audit --no-fund

# Make sure the Electron app shell itself got downloaded.
if [[ ! -d node_modules/electron/dist ]]; then
  node node_modules/electron/install.js
fi

echo "→ Building Buddy.app…"
rm -rf dist
npx electron-builder --mac --dir

APP="$(ls -d dist/mac*/Buddy.app 2>/dev/null | head -n 1 || true)"
if [[ -z "$APP" ]]; then
  echo "Couldn't find the finished app. Scroll up to see what went wrong."
  exit 1
fi

DEST="/Applications"
if [[ ! -w "$DEST" ]]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

# If an older Buddy is open, close it so it can be replaced.
if pgrep -x Buddy >/dev/null 2>&1; then
  osascript -e 'quit app "Buddy"' >/dev/null 2>&1 || true
  sleep 2
fi

rm -rf "$DEST/Buddy.app"
cp -R "$APP" "$DEST/"

echo ""
echo "✓ Buddy is installed in $DEST"
echo "  Opening it now. Tip: press ⌥ Space from any app to bring it up."
open "$DEST/Buddy.app"
