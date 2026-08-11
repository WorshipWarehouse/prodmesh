// ─────────────────────────────────────────────────────────────────────────────
//  How is this install running, what version is it, and can it update itself?
//
//  These three questions used to be answered by assuming the answer: the
//  version came from `git rev-parse` and updating meant `bash deploy/update.sh`
//  (git pull → npm ci → build → restart). That is true of exactly one kind of
//  install — a git checkout on macOS or Linux — and prodmesh now also ships as
//  a container image, with a desktop launcher to follow. A packaged copy has no
//  .git directory to read and nothing to pull.
//
//  Both assumptions were also the only things standing between the server and
//  Windows: `spawn('bash', …)` and `execFileSync('git', …)`. Nothing else here
//  is POSIX-specific — every integration is a network call.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const pkg = createRequire(import.meta.url)('../package.json');

/**
 * `git`       — a checkout with the deploy scripts: pull, rebuild, restart.
 * `container` — a Docker image. New version means a new image, by design:
 *               a container that rewrites its own code loses the property
 *               that makes it a container.
 * `package`   — anything else (a release archive, the desktop launcher).
 */
export function kind() {
  if (process.env.PRODMESH_DEPLOYMENT) return process.env.PRODMESH_DEPLOYMENT;
  if (process.env.PRODMESH_CONTAINER === '1' || existsSync('/.dockerenv')) return 'container';
  // The desktop launcher sets PRODMESH_DEPLOYMENT=desktop before importing the
  // server, so it is caught above. This is the belt-and-braces: inside a
  // packaged Electron app the code lives in app.asar, and a .git check would
  // never fire anyway — but an unpacked dev run of the launcher would look
  // like a git checkout and offer an Update button that cannot work.
  if (process.versions.electron) return 'desktop';
  if (existsSync(join(ROOT, '.git'))) return 'git';
  return 'package';
}

// Reading the commit costs a process fork (~29ms of blocked event loop), so it
// is resolved once. It cannot change without a restart in any case: updating
// restarts the service, which is exactly when this is recomputed.
let cached = null;

/**
 * Build stamp first, git second, package.json last.
 *
 * The stamp is what a packaged copy has: the image build passes the commit it
 * was built from, because by the time it runs there is no repository to ask.
 */
export function getVersion() {
  if (cached) return cached;
  const version = process.env.PRODMESH_VERSION || pkg.version || '0.0.0';

  if (process.env.PRODMESH_COMMIT) {
    cached = {
      version,
      commit: process.env.PRODMESH_COMMIT,
      subject: process.env.PRODMESH_COMMIT_SUBJECT ?? '',
      source: 'build',
    };
    return cached;
  }

  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
    const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: ROOT }).toString().trim();
    cached = { version, commit, subject, source: 'git' };
  } catch {
    // No stamp and no git: a release archive, or git isn't installed. The
    // version is still known — only the exact commit isn't.
    cached = { version, commit: 'unknown', subject: '', source: 'package' };
  }
  return cached;
}

/**
 * Whether the Update button should exist, and what to say instead when it
 * shouldn't. A button that cannot work is worse than no button: someone
 * presses it during a service and reads the silence as a broken install.
 */
export function updateCapability() {
  const deployment = kind();
  if (deployment === 'container') {
    return {
      supported: false,
      strategy: 'container',
      reason: 'Update by pulling a newer image and recreating the container.',
    };
  }
  if (deployment === 'desktop') {
    // The app updates itself through Electron's updater, driven by the tray —
    // not by this endpoint, which would be pulling a git checkout that a
    // packaged app does not have.
    return {
      supported: false,
      strategy: 'desktop',
      reason: 'Use “Check for updates” in the prodmesh menu bar icon.',
    };
  }
  if (deployment === 'git') {
    // The deploy scripts are bash, so a git checkout on Windows can still be
    // updated — just not from in here.
    if (process.platform === 'win32') {
      return { supported: false, strategy: 'manual', reason: 'Run git pull, npm ci and npm run build, then restart.' };
    }
    if (!existsSync(join(ROOT, 'deploy', 'update.sh'))) {
      return { supported: false, strategy: 'manual', reason: 'The deploy scripts are missing from this copy.' };
    }
    return { supported: true, strategy: 'git', reason: null };
  }
  return {
    supported: false,
    strategy: 'manual',
    reason: 'This copy was installed from a package — install the new version the same way.',
  };
}

/**
 * How to bring the server back after a restore, in the words that fit this
 * install. Restore replaces the database under a running process, so it always
 * needs a restart — the only question is who does it.
 */
export function restartHint() {
  switch (kind()) {
    case 'container':
      return 'Restart the container to finish (docker restart, or your orchestrator).';
    case 'git':
      return 'Restart the prodmesh service to finish — it will come back with everything restored.';
    default:
      return 'Quit and reopen prodmesh to finish.';
  }
}

/** Where the server log lives, and whether anything writes one here. */
export function logFile() {
  if (process.env.PRODMESH_LOG_FILE) return process.env.PRODMESH_LOG_FILE;
  return join(ROOT, 'logs', 'server.log');
}

/** Told to the Logs panel so its empty state names the right next step —
 *  "run install-service.sh" is wrong advice inside a container. */
export function logHint() {
  switch (kind()) {
    case 'container':
      return 'This deployment logs to the container runtime — use docker logs (or your orchestrator).';
    case 'git':
      return 'It appears once prodmesh runs as the installed service (deploy/install-service.sh).';
    default:
      return 'It appears once prodmesh runs as a service that redirects output to this file.';
  }
}

/** Tests reach in to re-resolve after changing the environment. */
export function resetForTests() {
  cached = null;
}
