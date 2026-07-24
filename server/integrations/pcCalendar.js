// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRATION: Planning Center Calendar  (read-only room bookings)
//
//  The authoritative event→room→time source (STATE.md roadmap item): what is
//  booked in which room, when. Same pattern as the Services client: auth →
//  fetch → normalize → cache, mock-first so the UI is demoable before the
//  Calendar product is granted to our token.
//
//  Auth: the same Personal Access Token as Services (products share the PAT;
//  Calendar just needs to be enabled for it).
//  Base:  https://api.planningcenteronline.com/calendar/v2
//
//  NOTE: real-API field names (marked ⓘ) must be confirmed against live data
//  the first time Calendar access is granted — the mock path exercises the
//  same normalized shapes. Room matching currently uses the instance's
//  `location` string (and any included resource names) matched against room
//  names; refine against real resource_bookings once we can see them.
// ─────────────────────────────────────────────────────────────────────────────

import { getSecret } from '../secrets.js';
import { report } from '../health.js';
import { rooms } from '../roomsStore.js';

const BASE = 'https://api.planningcenteronline.com/calendar/v2';
const CACHE_TTL_MS = 5 * 60 * 1000; // bookings change more often than plans
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
async function calGet(path) {
  const auth = Buffer.from(
    `${getSecret('planningCenter.appId')}:${getSecret('planningCenter.secret')}`,
  ).toString('base64');
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = new Error(`PC Calendar ${path} → HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const body = await res.json();
    report('pcCalendar', true);
    return body;
  } catch (err) {
    report('pcCalendar', false, String(err.message ?? err));
    throw err;
  }
}

// ── Room matching ─────────────────────────────────────────────────────────────
// A booking references rooms by name (location string / resource names); our
// rooms are keyed by id. Exact case-insensitive name match — conservative on
// purpose: a wrong match books an event into the wrong room's view, an
// unmatched one still shows with its location text.
export function roomIdsFor(names) {
  const wanted = new Set(
    names.filter(Boolean).map((n) => String(n).trim().toLowerCase()),
  );
  if (!wanted.size) return [];
  return Object.values(rooms)
    .filter((r) => wanted.has(r.name.trim().toLowerCase()))
    .map((r) => r.id);
}

// ── Normalizer (JSON:API → our clean shape) ───────────────────────────────────
// eventsById: included Event resources keyed by id (instance name/approval
// live on the Event, not the instance). ⓘ confirm attribute names live.
export function normalizeInstance(data, eventsById = new Map()) {
  const a = data.attributes ?? {};
  const eventRef = data.relationships?.event?.data ?? null;
  const event = eventRef ? eventsById.get(eventRef.id) : null;
  const ea = event?.attributes ?? {};
  const location = a.location ?? null;
  return {
    id: data.id,
    eventId: eventRef?.id ?? null,
    name: ea.name ?? a.name ?? 'Event', // ⓘ name lives on Event
    startsAt: a.starts_at ?? null,
    endsAt: a.ends_at ?? null,
    allDay: Boolean(a.all_day_event), // ⓘ
    location,
    approval: ea.approval_status ?? null, // ⓘ e.g. 'A' | 'P' | 'R' or words
    roomIds: roomIdsFor([location]),
  };
}

// ── Mock (no credentials / Calendar not yet granted) ──────────────────────────
// A deterministic weekly booking pattern over whatever range is asked for, in
// the server's local timezone, against rooms that exist in the live map plus
// one deliberately-unmatched location (the "Special Events" mapping problem).
const WEEKLY = [
  { dow: 0, name: 'Sunday Services', location: 'Main Auditorium', start: [7, 30], end: [13, 0], approval: 'A' },
  { dow: 0, name: 'Youth Sunday', location: 'Youth', start: [8, 30], end: [12, 30], approval: 'A' },
  { dow: 2, name: 'Chapel Night', location: 'Chapel', start: [17, 30], end: [21, 0], approval: 'A' },
  { dow: 3, name: 'Youth Night', location: 'Youth', start: [17, 30], end: [21, 30], approval: 'A' },
  { dow: 4, name: 'Worship Rehearsal', location: 'Main Auditorium', start: [18, 0], end: [21, 30], approval: 'A' },
  { dow: 6, name: 'Memorial Service', location: 'Chapel', start: [10, 0], end: [12, 0], approval: 'P' },
];

function mockInstances(startMs, endMs) {
  const out = [];
  const day = new Date(startMs);
  day.setHours(0, 0, 0, 0);
  for (; day.getTime() < endMs; day.setDate(day.getDate() + 1)) {
    for (const w of WEEKLY) {
      if (day.getDay() !== w.dow) continue;
      const at = ([h, m]) => {
        const d = new Date(day);
        d.setHours(h, m, 0, 0);
        return d;
      };
      const starts = at(w.start);
      if (starts.getTime() < startMs || starts.getTime() >= endMs) continue;
      const ymd = starts.toISOString().slice(0, 10);
      out.push({
        id: `mock-${w.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${ymd}`,
        eventId: null,
        name: w.name,
        startsAt: starts.toISOString(),
        endsAt: at(w.end).toISOString(),
        allDay: false,
        location: w.location,
        approval: w.approval,
        roomIds: roomIdsFor([w.location]),
        _mock: true,
      });
    }
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Bookings in [startMs, endMs) → { live, reason?, events }.
 * Mock (labeled live:false) when there's no token OR the token exists but the
 * Calendar product isn't granted to it yet (401/403) — that's a setup state,
 * not an outage, and the UI stays demoable through it. Real transport/server
 * failures still throw so outages read as outages.
 */
export async function getCalendarData(startMs, endMs) {
  if (!isConfigured()) {
    return { live: false, reason: 'no-token', events: mockInstances(startMs, endMs) };
  }
  try {
    return { live: true, events: await getEventInstances(startMs, endMs) };
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return { live: false, reason: 'not-granted', events: mockInstances(startMs, endMs) };
    }
    throw err;
  }
}

/** Real-API event instances overlapping [startMs, endMs), sorted by start. */
export function getEventInstances(startMs, endMs) {
  const key = `instances:${startMs}:${endMs}`;
  return cached(key, async () => {
    const instances = [];
    const eventsById = new Map();
    // ⓘ where[…] comparison params + pagination links verified against live
    // data when Calendar access lands.
    let path =
      `/event_instances?include=event&order=starts_at&per_page=100` +
      `&where[starts_at][gte]=${new Date(startMs).toISOString()}` +
      `&where[starts_at][lt]=${new Date(endMs).toISOString()}`;
    while (path) {
      const body = await calGet(path);
      for (const inc of body.included ?? []) {
        if (inc.type === 'Event') eventsById.set(inc.id, inc);
      }
      instances.push(...(body.data ?? []));
      const next = body.links?.next ?? null;
      path = next ? next.replace(BASE, '') : null;
    }
    return instances
      .map((d) => normalizeInstance(d, eventsById))
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  });
}
