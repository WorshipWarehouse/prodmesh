// Frontend client for the dashboard backend (which proxies to Companion).

export interface RoomMode {
  id: string;
  label: string;
  color: string;
  isStandby: boolean;
}

export interface RoomMeta {
  id: string;
  name: string;
  hasCompanion: boolean;
  modes: RoomMode[];
}

export interface Protection {
  active: boolean;
  label: string | null;
  lockedModes: string[];
  enforced: boolean;
}

export interface RoomState {
  mode: string | null;
  raw: string;
  online: boolean;
  source: 'companion' | 'mock';
  protection: Protection;
  error?: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const getRoom = (id: string) =>
  getJson<RoomMeta>(`/api/rooms/${encodeURIComponent(id)}`);

export const getRooms = () => getJson<RoomMeta[]>('/api/rooms');

export const getRoomState = (id: string) =>
  getJson<RoomState>(`/api/rooms/${encodeURIComponent(id)}/state`);

/** Thrown when a mode change is locked and the override PIN was missing/wrong. */
export class OverrideRequiredError extends Error {
  constructor() {
    super('override_required');
    this.name = 'OverrideRequiredError';
  }
}

export async function setRoomMode(
  id: string,
  mode: string,
  overridePin?: string,
): Promise<RoomState> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(id)}/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, overridePin }),
  });
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    if (body.error === 'override_required') throw new OverrideRequiredError();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<RoomState>;
}

// ── Admin auth (bearer token in localStorage) ─────────────────────────────────

const TOKEN_KEY = 'pm_admin_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export interface AuthStatus {
  admin: boolean;
  setupNeeded: boolean;
}

export const getAuthStatus = () =>
  fetch('/api/auth/status', { headers: authHeaders() }).then(
    (r) => r.json() as Promise<AuthStatus>,
  );

export async function loginAdmin(pin: string): Promise<boolean> {
  const res = await fetch('/api/auth/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) return false;
  const { token } = await res.json();
  setToken(token);
  return true;
}

export async function logoutAdmin(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }).catch(() => {});
  clearToken();
}

// ── Settings ──────────────────────────────────────────────────────────────────

export interface ScheduleWindow {
  id: string;
  label: string;
  days: number[];
  start: string;
  end: string;
  lock: string[];
}

export interface Settings {
  pins: { adminSet: boolean; overrideSet: boolean };
  schedules: Record<string, ScheduleWindow[]>;
}

export const getSettings = () =>
  fetch('/api/settings', { headers: authHeaders() }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<Settings>;
  });

/** Set/clear PINs. Empty string clears; undefined leaves unchanged. Admin
 *  bootstrap (first admin PIN) works without a token. */
export async function setPins(pins: { admin?: string; override?: string }): Promise<void> {
  const res = await fetch('/api/settings/pins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(pins),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function saveSchedules(
  schedules: Record<string, ScheduleWindow[]>,
): Promise<void> {
  const res = await fetch('/api/settings/schedules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ schedules }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── System ────────────────────────────────────────────────────────────────────

export interface Version {
  commit: string;
  subject: string;
}

export const getVersion = () => getJson<Version>('/api/system/version');

export const triggerUpdate = () =>
  fetch('/api/system/update', { method: 'POST', headers: authHeaders() }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
