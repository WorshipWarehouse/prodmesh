// Thin client for the Bitfocus Companion HTTP API (v4.x).
//
//   Read a custom variable:  GET  /api/custom-variable/<name>/value
//   Press a button:          POST /api/location/<page>/<row>/<column>/press
//
// Companion sends no CORS headers, which is exactly why this runs server-side.

import { report } from './health.js';

const TIMEOUT_MS = 2500;

function baseUrl(companion) {
  return `http://${companion.host}:${companion.port ?? 8000}`;
}

// Health is keyed by the machine we actually talked to (mock rooms never
// reach this module, so they never report).
export const healthKey = (companion) => `companion@${companion.host}:${companion.port ?? 8000}`;

/** Read a Companion custom variable; returns the raw string value. */
export async function readCustomVariable(companion, name) {
  const url = `${baseUrl(companion)}/api/custom-variable/${encodeURIComponent(name)}/value`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Companion GET ${name} → HTTP ${res.status}`);
    const value = (await res.text()).trim();
    report(healthKey(companion), true);
    return value;
  } catch (err) {
    report(healthKey(companion), false, String(err.message ?? err));
    throw err;
  }
}

/** Press a Companion button at a page/row/column location. */
export async function pressButton(companion, location) {
  const { page, row, column } = location;
  const url = `${baseUrl(companion)}/api/location/${page}/${row}/${column}/press`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Companion press ${page}/${row}/${column} → HTTP ${res.status}`);
    report(healthKey(companion), true);
  } catch (err) {
    report(healthKey(companion), false, String(err.message ?? err));
    throw err;
  }
}
