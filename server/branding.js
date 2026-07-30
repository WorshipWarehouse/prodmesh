// ─────────────────────────────────────────────────────────────────────────────
//  BRANDING  —  the institution's logo.
//
//  A church installing prodmesh should see their own mark, not another church's.
//  The bundled ProdMesh logo stays the default; this stores an override.
//
//  Threat notes (this is the app's only file-upload path, so they are all
//  load-bearing):
//    · The stored filename is generated here and never derived from user
//      input. atomicFile.js will mkdir -p whatever path it is handed, so a
//      caller-influenced name is an arbitrary-write primitive.
//    · SVG is refused outright. It is a script-bearing document, and a
//      same-origin /api/branding/logo.svg would execute in the origin that
//      holds the admin bearer token in localStorage.
//    · The type comes from MAGIC BYTES, never from Content-Type or the
//      filename — both are attacker-controlled. The sniffed type is what gets
//      served back, with nosniff.
//    · Stored under PRODMESH_DATA_DIR, never inside the repo: update.sh
//      aborts on a dirty tree, so an in-repo upload directory would break
//      self-update for every install on the first logo change.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PRODMESH_DATA_DIR ?? join(__dirname, 'data');
const BRANDING_DIR = join(DATA_DIR, 'branding');

/** 256 KB is generous for a logo and small enough to buffer safely. */
export const MAX_LOGO_BYTES = 256 * 1024;

// Accepted formats, identified by leading bytes. Raster only.
const SIGNATURES = [
  { type: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/gif', ext: 'gif', test: (b) => b.subarray(0, 6).toString('latin1').startsWith('GIF8') },
  {
    type: 'image/webp',
    ext: 'webp',
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/** The sniffed image type, or null if these bytes are not an accepted image. */
export function sniff(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return SIGNATURES.find((s) => s.test(buffer)) ?? null;
}

const metaPath = () => join(BRANDING_DIR, 'logo.json');

/** { type, ext, bytes, updatedAt } for the stored logo, or null for default. */
export function getLogoMeta() {
  try {
    const meta = JSON.parse(readFileSync(metaPath(), 'utf8'));
    return existsSync(join(BRANDING_DIR, `logo.${meta.ext}`)) ? meta : null;
  } catch {
    return null;
  }
}

/** The stored logo's bytes + type, or null. */
export function readLogo() {
  const meta = getLogoMeta();
  if (!meta) return null;
  try {
    return { ...meta, buffer: readFileSync(join(BRANDING_DIR, `logo.${meta.ext}`)) };
  } catch {
    return null;
  }
}

/**
 * Store a new logo. Throws with `code = 'bad_image'` / 'too_large' so the
 * route can answer 400 rather than 500.
 */
export function setLogo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error('No image received');
    err.code = 'bad_image';
    throw err;
  }
  if (buffer.length > MAX_LOGO_BYTES) {
    const err = new Error(`Logo must be under ${Math.floor(MAX_LOGO_BYTES / 1024)} KB`);
    err.code = 'too_large';
    throw err;
  }
  const kind = sniff(buffer);
  if (!kind) {
    const err = new Error('Logo must be a PNG, JPEG, GIF or WebP image (SVG is not accepted)');
    err.code = 'bad_image';
    throw err;
  }

  mkdirSync(BRANDING_DIR, { recursive: true });
  clearLogo(); // never leave a stale file of a different extension behind
  writeFileSync(join(BRANDING_DIR, `logo.${kind.ext}`), buffer);
  const meta = { type: kind.type, ext: kind.ext, bytes: buffer.length, updatedAt: Date.now() };
  writeFileSync(metaPath(), JSON.stringify(meta));
  return meta;
}

/** Revert to the bundled default. */
export function clearLogo() {
  for (const { ext } of SIGNATURES) {
    const f = join(BRANDING_DIR, `logo.${ext}`);
    if (existsSync(f)) unlinkSync(f);
  }
  if (existsSync(metaPath())) unlinkSync(metaPath());
}
