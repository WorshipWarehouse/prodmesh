// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRATION: Planning Center Services  (read-only plan display)
//
//  Pattern: auth → fetch → normalize → cache. Mock-first — with no credentials
//  configured it returns realistic sample plans so the UI is fully demoable;
//  drop a Personal Access Token into secrets.json and it goes live.
//
//  Auth: Personal Access Token (App ID + Secret) via HTTP Basic.
//  Base:  https://api.planningcenteronline.com/services/v2
//
//  NOTE: real-API field names (marked ⓘ) should be confirmed against live data
//  the first time a token is connected; the mock path exercises the same shapes.
// ─────────────────────────────────────────────────────────────────────────────

import { getSecret } from '../secrets.js';
import { report } from '../health.js';

const BASE = 'https://api.planningcenteronline.com/services/v2';
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 6000;

export function isConfigured() {
  return Boolean(getSecret('planningCenter.appId') && getSecret('planningCenter.secret'));
}

// ── tiny TTL cache ────────────────────────────────────────────────────────────
const cache = new Map(); // key → { expires, value }
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return hit.value;
  const value = await fn();
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}
export function clearCache() {
  cache.clear();
}

// ── HTTP (real API) ───────────────────────────────────────────────────────────
//  The single place real requests happen — every caller guards with
//  isConfigured() and the TTL cache sits above, so health reflects actual
//  fetches only: mock mode and cache hits never report.
async function pcGet(path) {
  const auth = Buffer.from(`${getSecret('planningCenter.appId')}:${getSecret('planningCenter.secret')}`).toString('base64');
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Planning Center ${path} → HTTP ${res.status}`);
    const body = await res.json();
    report('planningCenter', true);
    return body;
  } catch (err) {
    report('planningCenter', false, String(err.message ?? err));
    throw err;
  }
}

// ── Normalizers (JSON:API → our clean shapes) — field names verified live ─────
function normalizePlan(serviceType, data) {
  const a = data.attributes ?? {};
  return {
    id: data.id,
    serviceTypeId: serviceType.id,
    serviceTypeName: serviceType.name,
    title: a.title || a.series_title || 'Service',
    seriesTitle: a.series_title ?? null,
    dates: a.dates ?? null, // human string, e.g. "July 5, 2026"
    sortDate: a.sort_date ?? null, // ISO
    times: [], // hydrated via getPlanTimes()
    items: [], // hydrated via getPlanItems()
  };
}

function normalizeTime(t) {
  const a = t.attributes ?? {};
  return { id: t.id, name: a.name ?? null, startsAt: a.starts_at ?? null, endsAt: a.ends_at ?? null, type: a.time_type ?? null };
}

function normalizeItem(it, notesById = new Map()) {
  const a = it.attributes ?? {};
  // "Leader" is a per-item note (category "Leader"), not a first-class field.
  let leader = null;
  for (const ref of it.relationships?.item_notes?.data ?? []) {
    const note = notesById.get(ref.id);
    if (note && String(note.category_name).toLowerCase() === 'leader') {
      leader = String(note.content ?? '').trim() || null;
      break;
    }
  }
  return {
    id: it.id,
    sequence: a.sequence ?? null,
    title: a.title ?? '',
    type: a.item_type ?? null, // e.g. "song", "header", "item"
    length: a.length ?? null, // seconds
    key: a.key_name || null, // song key, e.g. "D"
    leader,
    description: a.description ?? null,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Upcoming plans for a service type ({ id, name }). Summaries — times/items
 *  are hydrated separately (see getPlanTimes / getPlanItems). */
export function getUpcomingPlans(serviceType, limit = 3) {
  return cached(`plans:${serviceType.id}:${limit}`, async () => {
    if (!isConfigured()) return mockPlans(serviceType, limit);
    const body = await pcGet(`/service_types/${serviceType.id}/plans?filter=future&order=sort_date&per_page=${limit}`);
    return (body.data ?? []).map((d) => normalizePlan(serviceType, d));
  });
}

// We surface services + rehearsals; other time types (auditions, meetings,
// sound-checks tagged "other") are noise for this display.
const SHOWN_TIME_TYPES = new Set(['service', 'rehearsal']);

/** One plan fetched directly by id — works for PAST plans too, which the
 *  upcoming list can't see. Returns null when not live or the plan isn't in
 *  this service type (404). Used to backfill labels on old show timelines. */
export function getPlan(serviceType, planId) {
  return cached(`plan:${serviceType.id}:${planId}`, async () => {
    if (!isConfigured()) return null; // never fabricate labels for real history
    try {
      const body = await pcGet(`/service_types/${serviceType.id}/plans/${planId}`);
      return body?.data ? normalizePlan(serviceType, body.data) : null;
    } catch {
      return null;
    }
  });
}

/** A Services person profile for the signed-in prodmesh user. Services exposes
 * photo_thumbnail_url directly, so this does not require People-app access. */
export function normalizePersonId(personId) {
  return String(personId ?? '').trim().replace(/^P(?=\d+$)/i, '');
}

export function getPersonProfile(personId) {
  const normalizedId = normalizePersonId(personId);
  return cached(`person:${normalizedId}`, async () => {
    if (!isConfigured() || !normalizedId) return null;
    try {
      const body = await pcGet(`/people/${encodeURIComponent(normalizedId)}`);
      const data = body?.data;
      const a = data?.attributes ?? {};
      return data ? {
        id: data.id,
        name: a.full_name ?? a.name ?? null,
        avatarUrl: a.photo_thumbnail_url ?? null,
      } : null;
    } catch {
      return null;
    }
  });
}

/** A plan's service + rehearsal times, chronological. (Auditions/meetings out.) */
export function getPlanTimes(serviceType, planId) {
  return cached(`times:${planId}`, async () => {
    if (!isConfigured()) return mockTimes();
    const body = await pcGet(`/service_types/${serviceType.id}/plans/${planId}/plan_times`);
    return (body.data ?? [])
      .filter((t) => SHOWN_TIME_TYPES.has(t.attributes?.time_type))
      .map(normalizeTime)
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  });
}

/** The order-of-service items for one plan (with song key + leader note). */
export function getPlanItems(serviceType, planId) {
  return cached(`items:${planId}`, async () => {
    if (!isConfigured()) return mockItems();
    const body = await pcGet(
      `/service_types/${serviceType.id}/plans/${planId}/items?per_page=100&order=sequence&include=item_notes`,
    );
    const notesById = new Map(
      (body.included ?? []).filter((i) => i.type === 'ItemNote').map((n) => [n.id, n.attributes]),
    );
    return (body.data ?? []).map((d) => normalizeItem(d, notesById));
  });
}

/** Series artwork + plan notes for the Event Detail page.
 *  Artwork lives on the plan's Series (verified live: `?include=series` →
 *  attributes.artwork_for_plan etc.); notes are the plan-level category notes. */
export function getPlanDetail(serviceType, planId) {
  return cached(`detail:${planId}`, async () => {
    if (!isConfigured()) return mockDetail();
    const [planBody, notesBody] = await Promise.all([
      pcGet(`/service_types/${serviceType.id}/plans/${planId}?include=series`),
      pcGet(`/service_types/${serviceType.id}/plans/${planId}/notes`),
    ]);
    const series = (planBody.included ?? []).find((i) => i.type === 'Series');
    const sa = series?.attributes ?? {};
    return {
      artwork: sa.has_artwork ? sa.artwork_for_plan || sa.artwork_for_dashboard || null : null,
      notes: (notesBody.data ?? [])
        .map((n) => ({
          category: n.attributes?.category_name ?? null,
          content: String(n.attributes?.content ?? '').trim(),
        }))
        .filter((n) => n.content),
    };
  });
}

// ── Mock data (used until a token is configured) ──────────────────────────────
function nextSunday(offsetWeeks = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7) + offsetWeeks * 7);
  return d;
}

function mockPlans(serviceType, limit) {
  return Array.from({ length: limit }, (_, i) => {
    const day = nextSunday(i);
    return {
      id: `mock-${serviceType.id}-${i}`,
      serviceTypeId: serviceType.id,
      serviceTypeName: serviceType.name,
      title: 'Weekend Service',
      seriesTitle: 'Summer in the Psalms',
      dates: day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
      sortDate: day.toISOString(),
      times: [],
      items: [],
      _mock: true,
    };
  });
}

function mockTimes() {
  const day = nextSunday(0);
  const at = (h) => {
    const t = new Date(day);
    t.setHours(h, 0, 0, 0);
    return t.toISOString();
  };
  return [
    { id: 'reh-1', name: 'Run Through', startsAt: at(8), endsAt: at(9), type: 'rehearsal' },
    { id: 'svc-1', name: '1st Service', startsAt: at(9), endsAt: at(10), type: 'service' },
    { id: 'svc-2', name: '2nd Service', startsAt: at(11), endsAt: at(12), type: 'service' },
  ];
}

function mockItems() {
  const rows = [
    { title: 'Countdown', type: 'media', length: 300 },
    { title: 'Welcome', type: 'header' },
    { title: 'Announcements', type: 'item', length: 180, leader: 'Pastor Dave' },
    { title: 'Worship Set', type: 'header' },
    { title: 'Praise', type: 'song', length: 300, key: 'G', leader: 'Avery' },
    { title: 'Great Are You Lord', type: 'song', length: 330, key: 'A', leader: 'Riley' },
    { title: 'Message', type: 'header' },
    { title: 'Sermon', type: 'item', length: 1800, leader: 'Koby' },
    { title: 'Response Song', type: 'song', length: 300, key: 'D', leader: 'Avery' },
    { title: 'Dismissal', type: 'header' },
  ];
  return rows.map((r, i) => ({
    id: `mock-item-${i}`,
    sequence: i + 1,
    title: r.title,
    type: r.type,
    length: r.length ?? null,
    key: r.key ?? null,
    leader: r.leader ?? null,
    description: null,
  }));
}

function mockDetail() {
  return {
    artwork: null,
    notes: [
      { category: 'Production', content: 'Confetti drop during the final song — cue from FOH.' },
      { category: 'Video', content: 'Baptism video rolls right after announcements.' },
    ],
  };
}
