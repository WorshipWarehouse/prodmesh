# prodmesh desktop launcher

A menu-bar app for the church with one booth Mac and a volunteer — the case
Docker does not serve. Same shape as Bitfocus Companion, which these churches
already run: an icon in the menu bar, a small window saying where the dashboard
is, and a button to open it.

```bash
npm ci --prefix desktop     # once
npm run build               # the frontend, at the repo ROOT — required
npm start   --prefix desktop   # run it
npm run pack --prefix desktop  # unpacked app in desktop/release
npm run dist --prefix desktop  # installers (.dmg / .exe)
```

## Why this is its own package

`deploy/update.sh` runs `npm ci` at the repo root on the production box. If
Electron were a root devDependency, every git-install church would download
~200MB of it on any update that touched the package files, for something they
will never run — and so would the Docker build stage. npm workspaces do not
help: a plain `npm ci` at the root installs all workspaces.

So `desktop/` has its own `package.json` and lockfile and is **not** a
workspace. Only the desktop build job installs it.

## The staging step

`build.mjs` assembles `desktop/.build/`, which is what electron-builder
packages — never the repo root, which carries a whole frontend toolchain.

The staged layout **mirrors the repo**:

```
.build/package.json       generated manifest (version + commit stamp)
.build/desktop/main.js    ← desktop/main.js
.build/server/…           ← server/, minus tests, tools and data
.build/dist/…             ← the built frontend
```

so `../server/index.js` in `main.js` resolves identically in development and
inside the packaged app. No dev-vs-packaged path branching, which is where
Electron apps usually acquire their "works on my machine" bugs.

Only three runtime dependencies ship — express, better-sqlite3, ws — pinned to
the exact versions in the root lockfile. React and friends are compiled into
`dist/` and are not needed as packages.

## Things that will bite you

**better-sqlite3 is native and must be built for Electron's ABI, not Node's.**
The staged install runs `--ignore-scripts` on purpose: the default install
fetches (or compiles) a binary for the *Node* ABI, which this tree never uses.
Worse, when no prebuild matches it falls back to node-gyp, which needs Python's
`distutils` — removed in Python 3.12, so the install fails outright building a
binary that was going to be thrown away. `build.mjs` skips that and runs
`electron-rebuild` instead.

If you see `NODE_MODULE_VERSION 115 … requires 130`, something ran the tree
under plain `node`. It cannot work; use `npm start --prefix desktop`.

**Editing `desktop/main.js` does nothing until you re-stage.** `npm start`
stages first; running `electron .build` by hand does not.

**One instance at a time.** `requestSingleInstanceLock()` means a second launch
surfaces the running app and exits 0. A stray instance from an earlier run will
therefore make the next launch look like it silently did nothing — check for
leftover processes before concluding the app is broken.

**The data directory is outside the bundle** (`app.getPath('userData')/data`),
so an update replaces the program and never a church's database. That is what
makes updating safe.

## CI

`.github/workflows/desktop.yml` builds on every branch and publishes installers
only from a `v*` tag, matching the rule that tags — not main — are the
deployment channel.

The smoke test runs the packaged app under **Electron** with
`PRODMESH_SMOKE=1`: it starts the server, prints its state, and exits non-zero
if it did not come up. It cannot run under plain `node` (see the ABI note), and
an ABI mismatch is the single most likely way this app ships broken — invisible
until something opens the database.

### macOS signing

Set these repository secrets; without them the build still runs and produces an
unsigned app, which is fine for testing and not fine for a volunteer:

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | Developer ID Application cert, `.p12`, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |
| `APPLE_ID` | the Apple ID that owns the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for notarization |
| `APPLE_TEAM_ID` | 10-character team id |

Unsigned, a volunteer meets *"prodmesh cannot be opened because the developer
cannot be verified"* — which substantially defeats the point of shipping a
double-clickable app.
