# Deploy — auto-start service

Run the dashboard as a background service that starts automatically and restarts
if it crashes. One script handles both platforms:

- **macOS** → a launchd LaunchAgent in `~/Library/LaunchAgents` (starts when the
  user logs in; the Producer Mac stays logged in). No sudo.
- **Linux** (e.g. a future Proxmox VM/LXC) → a systemd service in
  `/etc/systemd/system` (starts at boot). Uses sudo.

## Install

```bash
./deploy/install-service.sh             # build + install + start (port 8080)
PORT=9000 ./deploy/install-service.sh   # different port
./deploy/install-service.sh --no-build  # skip npm ci/build (already built)
```

The script resolves the absolute `node` path and the project directory itself,
so it works wherever the repo is checked out. Re-running it cleanly reloads the
service (safe to use as an "update" step after `git pull`).

## Manage

| | macOS (launchd) | Linux (systemd) |
|---|---|---|
| Logs | `tail -f logs/server.log` | `journalctl -u prodmesh -f` |
| Status | `launchctl print gui/$(id -u)/com.prodmesh.dashboard` | `systemctl status prodmesh` |
| Restart | re-run installer, or `launchctl kickstart -k gui/$(id -u)/com.prodmesh.dashboard` | `sudo systemctl restart prodmesh` |
| Remove | `./deploy/uninstall-service.sh` | `./deploy/uninstall-service.sh` |

## Updating

One command pulls the latest, rebuilds, and restarts the service:

```bash
./deploy/update.sh      # or:  npm run update
```

It aborts if the box has uncommitted local edits (so it never clobbers a
hand-edited `rooms.config.js`), only runs `npm ci` when dependencies actually
changed, and shows you exactly which commits landed. Room Macs pick up frontend
changes on their next browser refresh.

## Notes

- **Firewall (macOS):** the first run may prompt to allow `node` to accept
  incoming connections — allow it so other room Macs can reach the dashboard.
- **Port:** default 8080. Room Macs open `http://<this-host-ip>:<port>`.
