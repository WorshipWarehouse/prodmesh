import { getSecret, setSecrets } from '../secrets.js';
import { report } from '../health.js';

const TOKEN_URL = 'https://api.restream.io/oauth/token';
const API = 'https://api.restream.io/v2';
export const healthKey = () => 'restream';
export const configured = () => Boolean(getSecret('restream.clientId') && getSecret('restream.clientSecret'));

async function token(body) {
  const clientId = getSecret('restream.clientId');
  const clientSecret = getSecret('restream.clientSecret');
  if (!clientId || !clientSecret) throw new Error('Save the Restream Client ID and Client Secret first');
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  if (!res.ok) throw new Error(`Restream OAuth rejected the request (${res.status})`);
  return res.json();
}
export async function exchangeCode(code, redirectUri) {
  const value = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  storeTokenPair(value);
}

function storeTokenPair(value) {
  setSecrets({
    'restream.accessToken': value.access_token ?? '',
    'restream.refreshToken': value.refresh_token ?? '',
  });
  // A newly connected (or refreshed) account must not read as "not connected"
  // for the rest of the cache window.
  resetStatusCache();
}

/** Access tokens last one hour. Refresh only after Restream rejects one, so we
 * never discard a still-valid token just because the box clock is inaccurate. */
async function refreshAccessToken() {
  const refreshToken = getSecret('restream.refreshToken');
  if (!refreshToken) throw new Error('Restream connection expired. Connect the account again in Settings.');
  const value = await token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  if (!value.access_token || !value.refresh_token) throw new Error('Restream did not return a new token pair. Connect the account again in Settings.');
  storeTokenPair(value);
  return value.access_token;
}
export function authorizeUrl(redirectUri, state) {
  if (!configured()) throw new Error('Save the Restream Client ID and Client Secret first');
  return `https://api.restream.io/login?${new URLSearchParams({ response_type: 'code', client_id: getSecret('restream.clientId'), redirect_uri: redirectUri, state })}`;
}
/**
 * Broadcast state, shared by every caller for a few seconds.
 *
 * The `integration:restream` producer is now the only routine caller, so the
 * multiplication this originally defended against — an open route polled by
 * every dashboard on the church's own OAuth token — is gone. It stays because
 * the producer, the Settings connection check and the maintenance route can
 * still coincide, and one shared in-flight request is cheaper than three
 * identical ones. Bounded by time rather than by callers, either way.
 */
let cached = null; // { at, value } | { at, error }
let inFlight = null;
const TTL_MS = 10_000;

export function status() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.error ? Promise.reject(cached.error) : Promise.resolve(cached.value);
  }
  if (inFlight) return inFlight;
  inFlight = fetchStatus()
    .then((value) => { cached = { at: Date.now(), value }; return value; })
    .catch((err) => { cached = { at: Date.now(), error: err }; throw err; })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Drop the cache so a freshly connected account is reflected immediately. */
export function resetStatusCache() { cached = null; }

async function fetchStatus() {
  let accessToken = getSecret('restream.accessToken');
  if (!accessToken) throw new Error('Connect a Restream account first');
  let res = await fetch(`${API}/user/events/in-progress`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) {
    accessToken = await refreshAccessToken();
    res = await fetch(`${API}/user/events/in-progress`, { headers: { Authorization: `Bearer ${accessToken}` } });
  }
  if (!res.ok) { report(healthKey(), false, `Restream HTTP ${res.status}`); throw new Error(`Restream request failed (${res.status})`); }
  report(healthKey(), true);
  const data = await res.json(); const event = Array.isArray(data) ? data[0] : data.items?.[0];
  return { connected: true, status: event ? 'live' : 'offline', title: event?.title ?? 'No active broadcast', startedAt: event?.startedAt ?? null };
}
