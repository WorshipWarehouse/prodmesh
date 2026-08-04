# prodmesh desktop launcher

A menu-bar app for the church with one booth Mac and a volunteer — the case
Docker does not serve. Same shape as Bitfocus Companion, which these churches
already run: an icon in the menu bar, a small window saying where the dashboard
is, and a button to open it.

```bash
npm ci --prefix desktop     # once
npm run build               # the frontend, at the repo ROOT — required
npm start   --prefix desktop   # fast iteration (see the caveat below)
npm test    --prefix desktop   # status-window wiring (needs a window server)
npm run app  --prefix desktop  # package + launch the REAL app (macOS)
npm run pack --prefix desktop  # unpacked app in desktop/release
npm run dist --prefix desktop  # installers (.dmg / .exe)
```

**`npm start` will say "Electron" in the dock and menu bar.** Not a bug and not
fixable from our code: an unpacked run *is* `Electron.app`, and macOS reads the
name from the running bundle's `Info.plist`, which belongs to Electron.
`app.setName()` governs `app.getName()` and the userData path — not the dock.

The packaged app has its own `Info.plist` and reads **ProdMesh** everywhere.
Use `npm run app` when you want to see what a church sees; `npm start` is for
iterating, where a wrong dock label costs nothing.

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

**Preloads are sandboxed.** Only `ipcRenderer` and `contextBridge` are
available in `preload.cjs` — `shell`, `dialog` and the rest of the electron
module are `undefined` there. Calling one fails as an uncaught error in the
renderer console, which nobody is watching, so the UI just quietly does
nothing. Anything that acts on the machine belongs in `main.js` over IPC.
`npm test --prefix desktop` guards exactly this.

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

Signing and notarization are separate credentials and separate steps: the
certificate proves who built it, the API key asks Apple to bless it.

| Secret | What it is |
|---|---|
| `MACOS_CERT_P12` | Developer ID Application cert exported from Keychain as `.p12`, **base64-encoded** |
| `MACOS_CERT_P12_PASSWORD` | the password chosen when exporting that `.p12` |
| `APPLE_API_KEY_P8` | App Store Connect API key `.p8`, **base64-encoded** |
| `APPLE_API_KEY_ID` | the key's id (the `XXXXXXXXXX` in `AuthKey_XXXXXXXXXX.p8`) |
| `APPLE_API_ISSUER_ID` | issuer UUID from App Store Connect → Users and Access → Integrations |

An App Store Connect API key rather than an Apple ID + app-specific password:
`notarytool` prefers it, and it does not break the day someone changes the
Apple ID's password or its 2FA.

Both files are base64-encoded because a GitHub secret holds text, not bytes.
The `.p8` is decoded back to a file on the runner (notarytool needs a path),
into `RUNNER_TEMP` rather than the workspace — the workspace gets archived as
build artefacts.

Apple issues the `.p8` **once**; there is no way to download it again. Keep the
original somewhere safe before base64-encoding it into a secret.

#### Checking the certificate before you set the secrets

```bash
./desktop/check-signing-cert.sh ~/Desktop/prodmesh-cert.p12
./desktop/check-signing-cert.sh ~/Desktop/prodmesh-cert.p12.b64 ~/Desktop/pw.txt
```

The same check the workflow's preflight makes, so a pass here means a pass
there. It separates the three failures that otherwise look identical: not
valid base64, wrong password, and a `.p12` carrying the certificate but not
its private key.

**Set secrets with redirection, not a paste.** `gh secret set NAME < file`
sends the file's exact bytes. A paste is where a truncation or a stray newline
gets in — and `gh` does not strip a trailing newline, so a password file
ending in one produces a secret that cannot open the certificate. The checker
reads files byte-exactly for that reason and warns about trailing whitespace.

#### Exporting the certificate

```bash
security export -t identities -f pkcs12 -o ~/Desktop/prodmesh-cert.p12
```

`-t identities` takes the certificate **and** its private key. Keychain Access
exports only the certificate unless you select the identity itself, which
produces a `.p12` that imports without error and then cannot sign anything.

Reading it back with OpenSSL 3 needs `-legacy` (Apple writes PKCS#12 with
legacy encryption), which is why `openssl pkcs12` may report no key on a
perfectly good export. macOS's own `security import` — which is what
electron-builder uses — does not care.

Unsigned, a volunteer meets *"prodmesh cannot be opened because the developer
cannot be verified"* — which substantially defeats the point of shipping a
double-clickable app.
