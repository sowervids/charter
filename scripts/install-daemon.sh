#!/bin/sh
# Install charterd as a launchd LaunchAgent (KeepAlive; survives crashes,
# starts at login). Run from the repo root: sh scripts/install-daemon.sh
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/com.charter.charterd.plist"

mkdir -p "$HOME/Library/LaunchAgents" "$REPO/var"
sed -e "s|__REPO__|$REPO|g" -e "s|/usr/local/bin/node|$NODE_BIN|g" \
  "$REPO/scripts/com.charter.charterd.plist" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "charterd installed and loaded. Logs: $REPO/var/charterd.out.log"
echo "Uninstall: launchctl unload $PLIST && rm $PLIST"
