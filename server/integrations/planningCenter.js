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
async function pcGet(path) {
  const auth = Buffer.from(`${getSecret('planningCenter.appId')}:${getSecret('planningCenter.secret')}`).toString('base64');
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Planning Center ${path} → HTTP ${res.status}`);
  return res.json();
}

// ── Normalizers (JSON:API → our clean shapes) ─────────────────────────────────
function normalizePlan(serviceType, data, included = []) {
  const a = data.attributes ?? {};
  const timeIds = new Set((data.relationships?.plan_times?.data ?? []).map((t) => t.id));
  const times = included
    .filter((i) => i.type === 'PlanTime' && timeIds.has(i.id))
    .map(normalizeTime);
  return {
    id: data.id,
    serviceTypeId: serviceType.id,
    serviceTypeName: serviceType.name,
    title: a.title || a.series_title || 'Service', // ⓘ
    seriesTitle: a.series_title ?? null, // ⓘ
    dates: a.dates ?? null, // ⓘ human string, e.g. "July 5, 2026"
    sortDate: a.sort_date ?? null, // ⓘ ISO
    times,
    items: [], // filled on demand via getPlanItems()
  };
}

function normalizeTime(t) {
  const a = t.attributes ?? {};
  return { id: t.id, name: a.name ?? null, startsAt: a.starts_at ?? null, endsAt: a.ends_at ?? null, type: a.time_type ?? null }; // ⓘ
}

function normalizeItem(it) {
  const a = it.attributes ?? {};
  return {
    id: it.id,
    sequence: a.sequence ?? null, // ⓘ
    title: a.title ?? '', // ⓘ
    type: a.item_type ?? null, // ⓘ e.g. "song", "header", "media"
    length: a.length ?? null, // ⓘ seconds
    description: a.description ?? null,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Upcoming plans for a service type ({ id, name }). Summaries (no items). */
export function getUpcomingPlans(serviceType, limit = 3) {
  return cached(`plans:${serviceType.id}:${limit}`, async () => {
    if (!isConfigured()) return mockPlans(serviceType, limit);
    const body = await pcGet(
      `/service_types/${serviceType.id}/plans?filter=future&order=sort_date&per_page=${limit}&include=plan_times`,
    );
    return (body.data ?? []).map((d) => normalizePlan(serviceType, d, body.included ?? []));
  });
}

/** The order-of-service items for one plan. */
export function getPlanItems(serviceType, planId) {
  return cached(`items:${planId}`, async () => {
    if (!isConfigured()) return mockItems();
    const body = await pcGet(`/service_types/${serviceType.id}/plans/${planId}/items?per_page=100&order=sequence`);
    return (body.data ?? []).map(normalizeItem);
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
    const at = (h) => {
      const t = new Date(day);
      t.setHours(h, 0, 0, 0);
      return t.toISOString();
    };
    return {
      id: `mock-${serviceType.id}-${i}`,
      serviceTypeId: serviceType.id,
      serviceTypeName: serviceType.name,
      title: 'Weekend Service',
      seriesTitle: 'Summer in the Psalms',
      dates: day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
      sortDate: day.toISOString(),
      times: [
        { id: `${i}-1`, name: '9:00 AM', startsAt: at(9), endsAt: at(10), type: 'service' },
        { id: `${i}-2`, name: '11:00 AM', startsAt: at(11), endsAt: at(12), type: 'service' },
      ],
      items: [],
      _mock: true,
    };
  });
}

function mockItems() {
  const rows = [
    ['Countdown', 'media', 300],
    ['Welcome', 'header', 120],
    ['Worship Set', 'header', null],
    ['Song — Praise', 'song', 300],
    ['Song — Great Are You Lord', 'song', 330],
    ['Announcements', 'media', 180],
    ['Message', 'header', 1800],
    ['Response Song', 'song', 300],
    ['Dismissal', 'header', 120],
  ];
  return rows.map(([title, type, length], i) => ({
    id: `mock-item-${i}`,
    sequence: i + 1,
    title,
    type,
    length,
    description: null,
  }));
}
