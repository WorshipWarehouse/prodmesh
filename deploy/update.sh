#!/usr/bin/env bash
#
# Update the dashboard to the latest committed version, in one step:
#   git pull  →  (npm ci if deps changed)  →  build  →  restart the service.
#
# Safe to run on the production box. Aborts if you have uncommitted local edits
# so it never clobbers machine-specific changes.
#
# Usage:  ./deploy/update.sh      (or: npm run update)
#
set -euo pipefail

LABEL="com.prodmesh.dashboard"   # macOS launchd label
UNIT="prodmesh"                  # linux systemd unit

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"

# Don't update over uncommitted local changes (e.g. a hand-edited rooms.config).
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ You have uncommitted local changes — resolve these first:"
  git status --short
  echo ""
  echo "  Commit them, or stash with:  git stash"
  exit 1
fi

BEFORE="$(git rev-parse --short HEAD)"
echo "→ Pulling latest…"
git pull --ff-only
AFTER="$(git rev-parse --short HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  echo "✓ Already up to date ($AFTER). Nothing to do."
  exit 0
fi

echo "→ Updated $BEFORE → $AFTER:"
git --no-pager log --oneline "$BEFORE..$AFTER"

# Reinstall dependencies only when the package files actually changed.
if ! git diff --quiet "$BEFORE" "$AFTER" -- package.json package-lock.json; then
  echo "→ Dependencies changed — running npm ci…"
  npm ci
fi

echo "→ Building…"
npm run build

echo "→ Restarting service…"
OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  DOMAIN="gui/$(id -u)"
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "✓ launchd service restarted."
  else
    echo "! Service not installed yet — run ./deploy/install-service.sh"
  fi
elif [ "$OS" = "Linux" ]; then
  if systemctl list-unit-files 2>/dev/null | grep -q "^$UNIT.service"; then
    sudo systemctl restart "$UNIT"
    echo "✓ systemd service restarted."
  else
    echo "! Service not installed yet — run ./deploy/install-service.sh"
  fi
else
  echo "! Unknown OS — restart the service manually."
fi

echo "✓ Update complete ($AFTER). Room Macs will pick it up on next refresh."
