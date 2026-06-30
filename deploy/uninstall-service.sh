#!/usr/bin/env bash
#
# Stop and remove the Production Dashboard auto-start service.
#   macOS → unloads + deletes the launchd LaunchAgent
#   Linux → disables + deletes the systemd unit (needs sudo)
#
set -euo pipefail

LABEL="com.prodmesh.dashboard"
UNIT="prodmesh"

OS="$(uname -s)"
case "$OS" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
    DOMAIN="gui/$(id -u)"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "✓ Removed launchd service ($LABEL)."
    ;;
  Linux)
    sudo systemctl disable --now "$UNIT" 2>/dev/null || true
    sudo rm -f "/etc/systemd/system/$UNIT.service"
    sudo systemctl daemon-reload
    echo "✓ Removed systemd service ($UNIT)."
    ;;
  *)
    echo "✗ Unsupported OS: $OS" >&2
    exit 1
    ;;
esac
