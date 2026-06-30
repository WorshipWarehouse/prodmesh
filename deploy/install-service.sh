#!/usr/bin/env bash
#
# Install the Production Dashboard as an auto-starting background service.
#
#   macOS  → a launchd LaunchAgent  (~/Library/LaunchAgents)
#   Linux  → a systemd service      (/etc/systemd/system, needs sudo)
#
# It builds the app, then installs + starts the service so it survives logout
# (Linux: reboot) and restarts automatically if it crashes.
#
# Usage:
#   ./deploy/install-service.sh            # build + install + start
#   PORT=9000 ./deploy/install-service.sh  # serve on a different port
#   ./deploy/install-service.sh --no-build # skip npm install/build
#
set -euo pipefail

LABEL="com.prodmesh.dashboard"   # macOS launchd label
UNIT="prodmesh"                  # linux systemd unit name
PORT="${PORT:-8080}"

# Resolve the project root (this script lives in <root>/deploy).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

# Absolute node path — launchd/systemd don't inherit your shell PATH.
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "✗ node not found on PATH. Install Node 20+ first (see .nvmrc)." >&2
  exit 1
fi

echo "→ Project:  $APP_DIR"
echo "→ Node:     $NODE_BIN ($("$NODE_BIN" -v))"
echo "→ Port:     $PORT"

# Build unless told otherwise.
if [ "${1:-}" != "--no-build" ]; then
  echo "→ Installing dependencies + building…"
  ( cd "$APP_DIR"
    if [ -f package-lock.json ]; then npm ci; else npm install; fi
    npm run build )
fi

OS="$(uname -s)"
case "$OS" in
  Darwin) ##################################### macOS / launchd ##############
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
    mkdir -p "$HOME/Library/LaunchAgents" "$APP_DIR/logs"

    echo "→ Writing LaunchAgent: $PLIST"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$APP_DIR/server/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PORT</key><string>$PORT</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$APP_DIR/logs/server.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/logs/server.log</string>
</dict>
</plist>
PLIST

    DOMAIN="gui/$(id -u)"
    # Reload cleanly if already installed.
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    launchctl enable "$DOMAIN/$LABEL"
    launchctl kickstart -k "$DOMAIN/$LABEL" || true

    echo "✓ Installed and started."
    echo "  Logs:    tail -f $APP_DIR/logs/server.log"
    echo "  Status:  launchctl print $DOMAIN/$LABEL | grep state"
    echo "  Stop:    ./deploy/uninstall-service.sh"
    ;;

  Linux) ##################################### Linux / systemd ###############
    RUN_USER="${SUDO_USER:-$USER}"
    UNIT_FILE="/etc/systemd/system/$UNIT.service"
    echo "→ Writing systemd unit: $UNIT_FILE (as $RUN_USER, via sudo)"

    sudo tee "$UNIT_FILE" >/dev/null <<UNIT
[Unit]
Description=Production Dashboard (prodmesh)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$NODE_BIN $APP_DIR/server/index.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

    sudo systemctl daemon-reload
    sudo systemctl enable --now "$UNIT"

    echo "✓ Installed and started."
    echo "  Logs:    journalctl -u $UNIT -f"
    echo "  Status:  systemctl status $UNIT"
    echo "  Stop:    ./deploy/uninstall-service.sh"
    ;;

  *)
    echo "✗ Unsupported OS: $OS (expected Darwin or Linux)." >&2
    exit 1
    ;;
esac

echo ""
echo "Dashboard should be live at:  http://$(hostname):$PORT  (and http://localhost:$PORT)"
