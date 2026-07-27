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

/**
 * Probe: read the configured state variable (the request the dashboard
 * actually depends on), else just reach the web UI. Returns a human detail
 * line; throws with the failure reason.
 */
export async function ping(companion) {
  if (companion.variable) {
    const value = await readCustomVariable(companion, companion.variable);
    // Report the SHAPE of the answer, not the bytes. This string is surfaced
    // to the operator through the connectivity status chip, so echoing the
    // response verbatim turned a mistyped (or malicious) host into a readable
    // fetch of whatever it pointed at. Host validation blocks the URL games
    // now; not echoing bodies means it stays closed if that ever regresses.
    const summary = value === ''
      ? 'empty'
      : `${JSON.stringify(value.slice(0, 24))}${value.length > 24 ? '…' : ''}`;
    return `$(${companion.variable}) = ${summary}`;
  }
  try {
    const res = await fetch(baseUrl(companion), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Companion → HTTP ${res.status}`);
    report(healthKey(companion), true);
    return 'reachable (no state variable configured)';
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
