// Thin client for the Bitfocus Companion HTTP API (v4.x).
//
//   Read a custom variable:  GET  /api/custom-variable/<name>/value
//   Press a button:          POST /api/location/<page>/<row>/<column>/press
//
// Companion sends no CORS headers, which is exactly why this runs server-side.

const TIMEOUT_MS = 2500;

function baseUrl(companion) {
  return `http://${companion.host}:${companion.port ?? 8000}`;
}

/** Read a Companion custom variable; returns the raw string value. */
export async function readCustomVariable(companion, name) {
  const url = `${baseUrl(companion)}/api/custom-variable/${encodeURIComponent(name)}/value`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Companion GET ${name} → HTTP ${res.status}`);
  return (await res.text()).trim();
}

/** Press a Companion button at a page/row/column location. */
export async function pressButton(companion, location) {
  const { page, row, column } = location;
  const url = `${baseUrl(companion)}/api/location/${page}/${row}/${column}/press`;
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Companion press ${page}/${row}/${column} → HTTP ${res.status}`);
}
