// Secrets loader for external service integrations (Planning Center, etc.).
//
// Unlike PINs (which are hashed), integration tokens must be used as-is, so they
// live in a git-ignored file: server/data/secrets.json (see secrets.example.json
// for the shape). Env vars override file values, so a Proxmox/CI deploy can
// inject secrets without a file.
//
//   getSecret('planningCenter.appId')  → string | undefined

import { readFileSync, existsSync } from 'node:fs';
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
