// Secrets loader for external service integrations (Planning Center, etc.).
//
// Unlike PINs (which are hashed), integration tokens must be used as-is, so they
// live in a git-ignored file: server/data/secrets.json (see secrets.example.json
// for the shape). Env vars override file values, so a Proxmox/CI deploy can
// inject secrets without a file.
//
//   getSecret('planningCenter.appId')  → string | undefined

import { readFileSync, existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PRODMESH_DATA_DIR ?? join(__dirname, 'data');
const FILE = join(DATA_DIR, 'secrets.json');

let cache = null;

function load() {
  if (cache) return cache;
  if (existsSync(FILE)) {
    try {
      cache = JSON.parse(readFileSync(FILE, 'utf8'));
    } catch {
      cache = {};
    }
  } else {
    cache = {};
  }
  return cache;
}

/** Dotted-path lookup, with an env override (PRODMESH_SECRET_<PATH>). */
export function getSecret(path) {
  const envKey = `PRODMESH_SECRET_${path.replace(/\./g, '_').toUpperCase()}`;
  if (process.env[envKey]) return process.env[envKey];
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), load());
}

// ── Writing (Admin → Secrets) ────────────────────────────────────────────────
//
//  Deliberately WRITE-ONLY. Nothing here ever returns a stored value, and no
//  route exposes one — the only way to read a secret back is to open the file
//  on the server, which already implies you own the box. That keeps a stolen
//  admin session from exfiltrating the church's Planning Center token or Slack
//  bot token; it can overwrite them (loudly, and things break) but not learn
//  them.
//
//  Callers get to know only whether a value is SET, and its length, which is
//  enough to tell "configured" from "not" and to spot a truncated paste.

/** Every secret the app actually reads. Anything else is refused. */
export const SECRET_KEYS = [
  { path: 'planningCenter.appId', label: 'Planning Center App ID' },
  { path: 'planningCenter.secret', label: 'Planning Center Secret' },
  { path: 'slack.test.botOauthToken', label: 'Slack bot token (test)' },
  { path: 'slack.test.channel', label: 'Slack channel (test)' },
  { path: 'slack.prod.botOauthToken', label: 'Slack bot token (prod)' },
  { path: 'slack.prod.channel', label: 'Slack channel (prod)' },
  { path: 'slack.use', label: 'Active Slack environment (test|prod)' },
];

const isSecretKey = (path) => SECRET_KEYS.some((k) => k.path === path);

/**
 * What is configured — never what it is. `env: true` means an environment
 * variable is winning, so editing the file here would have no effect.
 */
export function describeSecrets() {
  const file = load();
  return SECRET_KEYS.map(({ path, label }) => {
    const envKey = `PRODMESH_SECRET_${path.replace(/\./g, '_').toUpperCase()}`;
    const fromEnv = Boolean(process.env[envKey]);
    const fileValue = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), file);
    const value = fromEnv ? process.env[envKey] : fileValue;
    return {
      path,
      label,
      set: Boolean(value),
      length: value ? String(value).length : 0,
      env: fromEnv,
    };
  });
}

/**
 * Set or clear secrets. `updates` is { 'dotted.path': 'value' }; an empty
 * string clears. Writes the file with owner-only permissions — it was 0644,
 * i.e. readable by every local account on the box.
 */
export function setSecrets(updates) {
  const next = structuredClone(load());
  const touched = [];
  for (const [path, raw] of Object.entries(updates ?? {})) {
    if (!isSecretKey(path)) {
      const err = new Error(`Unknown secret "${path}"`);
      err.code = 'unknown_secret';
      throw err;
    }
    const value = String(raw ?? '');
    if (value.length > 500) {
      const err = new Error(`Value for "${path}" is too long`);
      err.code = 'bad_secret';
      throw err;
    }
    const parts = path.split('.');
    const leaf = parts.pop();
    let node = next;
    for (const part of parts) {
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
      node = node[part];
    }
    if (value === '') delete node[leaf];
    else node[leaf] = value;
    touched.push(path);
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(FILE, 0o600); // an existing file keeps its old mode without this
  } catch {
    /* best effort — Windows and some mounts don't support it */
  }
  cache = next;
  return touched;
}

/** Drop the memoized copy (tests, and after an out-of-band file edit). */
export function reloadSecrets() {
  cache = null;
}
