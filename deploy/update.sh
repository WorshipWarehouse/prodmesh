#!/usr/bin/env bash
#
# Update the dashboard to the newest RELEASE, in one step:
#   fetch  →  check out the newest v* tag  →  (npm ci if deps changed)
#          →  build  →  restart the service.
#
# Safe to run on the production box. Aborts if you have uncommitted local edits
# so it never clobbers machine-specific changes.
#
# Usage:  ./deploy/update.sh            (or: npm run update)   — release channel
#         ./deploy/update.sh --edge     track main instead
#
#
# WHY RELEASES AND NOT main
#
# main is where work lands; a release tag is where the maintainer says "this is
# safe in a room on a Sunday". Those are different judgements and they need
# different moments — merging a branch means the work is finished, not that it
# has been through a service.
#
# This matters more than it sounds because Admin → System has an Update button,
# and a volunteer can press it. On the release channel the worst that button can
# do is move the box between versions that were deliberately cut. Tracking main
# would let whatever was merged on Friday night arrive on Sunday morning.
#
# --edge is for the maintainer's own box when they want the tip of main.
#
set -euo pipefail

LABEL="com.prodmesh.dashboard"   # macOS launchd label
UNIT="prodmesh"                  # linux systemd unit

CHANNEL="release"
case "${1:-}" in
  --edge) CHANNEL="edge" ;;
  "") ;;
  *) echo "✗ Unknown option '$1'. Usage: update.sh [--edge]"; exit 2 ;;
esac

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

echo "→ Fetching…"
git fetch --tags --prune --force origin

if [ "$CHANNEL" = "edge" ]; then
  echo "→ Channel: edge (main)"
  git checkout main
  git pull --ff-only
else
  # Newest stable release. The pattern is strict on purpose: it must not pick
  # up a pre-release (v1.2.0-rc1) or a hand-written label like the old
  # "stable-release" tag, which looked like a channel pointer and was not one.
  TARGET="$(git tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1 || true)"
  if [ -z "$TARGET" ]; then
    echo "✗ No release tags found in this checkout."
    echo "  Use --edge to track main deliberately."
    exit 1
  fi

  # Never move backwards. A box sitting on unreleased code (it was updated with
  # --edge, or it predates the release channel) must not be silently rolled back
  # to the last tag — that would be a downgrade dressed up as an update.
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse "$TARGET^{commit}")" ] \
     && git merge-base --is-ancestor "$TARGET" HEAD; then
    echo "✓ Already ahead of the newest release ($TARGET) — nothing to do."
    echo "  This box is running unreleased code. It will update when a newer"
    echo "  release is tagged, or now with:  ./deploy/update.sh --edge"
    exit 0
  fi

  echo "→ Channel: release ($TARGET)"
  # Detached on purpose: a release is a point in history, not a branch, and a
  # local branch here would only invite a divergent commit on the booth machine.
  git checkout --detach --quiet "$TARGET"
fi

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
